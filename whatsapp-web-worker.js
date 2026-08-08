"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ quiet: true });

const express = require("express");
const QRCode = require("qrcode");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const HOST = process.env.WHATSAPP_WEB_HOST || "127.0.0.1";
const PORT = Number(process.env.WHATSAPP_WEB_PORT || 3001);
const CLIENT_ID = process.env.WHATSAPP_WEB_CLIENT_ID || "ocrid";
const SESSION_PATH = path.resolve(process.env.WHATSAPP_WEB_SESSION_PATH || ".wwebjs_auth");
const OCR_API_URL = (process.env.OCR_API_URL || "http://127.0.0.1:6017").replace(/\/$/, "");
const API_KEY = process.env.WHATSAPP_BRIDGE_API_KEY || "";
const ALLOW_GROUPS = process.env.WHATSAPP_WEB_ALLOW_GROUPS === "true";
const PROCESS_OWN_MESSAGES = process.env.WHATSAPP_WEB_PROCESS_OWN_MESSAGES === "true";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OCR_TIMEOUT_MS = positiveIntegerEnv("WHATSAPP_OCR_TIMEOUT_MS", 600_000);
const MISSING_ID_MEDIA_DELAY_MS = positiveIntegerEnv("WHATSAPP_MISSING_ID_MEDIA_DELAY_MS", 1200);
const MEDIA_DOWNLOAD_RETRIES = positiveIntegerEnv("WHATSAPP_MEDIA_DOWNLOAD_RETRIES", 2);
const MEDIA_DOWNLOAD_RETRY_DELAY_MS = positiveIntegerEnv("WHATSAPP_MEDIA_DOWNLOAD_RETRY_DELAY_MS", 900);

const app = express();
app.use(express.json({ limit: "256kb" }));

const state = {
  status: "initializing",
  startedAt: new Date().toISOString(),
  authenticatedAt: null,
  readyAt: null,
  lastQrAt: null,
  lastError: null,
  lastMessage: null,
  lastInboundMessage: null,
  lastFailure: null,
  messageStats: {
    events: 0,
    ignored: 0,
    processed: 0,
    ocrSucceeded: 0,
    ocrFailed: 0,
  },
};

const processedMessages = new Set();
const activeMessages = new Set();
let activeQr = null;
const chromePath = resolveChromePath();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  },
});

client.on("qr", (qr) => {
  activeQr = qr;
  state.status = "waiting_for_qr";
  state.lastQrAt = new Date().toISOString();
  console.log("\nScan this QR code in WhatsApp: Linked devices > Link a device\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  activeQr = null;
  state.status = "authenticated";
  state.authenticatedAt = new Date().toISOString();
  console.log("WhatsApp authentication succeeded. Waiting for the client to become ready.");
});

client.on("ready", () => {
  activeQr = null;
  state.status = "ready";
  state.readyAt = new Date().toISOString();
  state.lastError = null;
  console.log("WhatsApp Web worker is ready.");
});

client.on("auth_failure", (message) => {
  state.status = "auth_failure";
  state.lastError = String(message);
  console.error("WhatsApp authentication failed:", message);
});

client.on("disconnected", (reason) => {
  state.status = "disconnected";
  state.lastError = String(reason);
  console.error("WhatsApp client disconnected:", reason);
});

client.on("message", (message) => {
  void handleIncomingMessage(message, "message");
});

client.on("message_create", (message) => {
  void handleIncomingMessage(message, "message_create");
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "whatsapp-web-worker", whatsapp: statusPayload() });
});

app.get("/whatsapp/status", (_request, response) => {
  response.json({ success: true, data: statusPayload() });
});

app.get("/whatsapp/qr.svg", async (_request, response, next) => {
  if (!activeQr) {
    return response.status(404).json({
      success: false,
      error: isReady() ? "WhatsApp is already connected." : "No active QR code is available yet.",
    });
  }
  try {
    const svg = await QRCode.toString(activeQr, { type: "svg", margin: 2, width: 480 });
    response.set("Cache-Control", "no-store");
    return response.type("image/svg+xml").send(svg);
  } catch (error) {
    return next(error);
  }
});

app.post("/whatsapp/check-numbers", requireApiKey, async (request, response) => {
  const numbers = request.body?.numbers;
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return response.status(400).json({ success: false, error: "Provide a non-empty numbers array." });
  }
  if (!isReady()) {
    return response.status(503).json({ success: false, error: "WhatsApp client is not ready." });
  }

  const results = [];
  for (const number of numbers) {
    try {
      const normalized = normalizePhoneNumber(number);
      const registeredId = await client.getNumberId(normalized.number);
      results.push({
        number,
        formatted: registeredId?._serialized || normalized.chatId,
        status: registeredId ? "Registered" : "Not Registered",
      });
    } catch (error) {
      results.push({ number, formatted: null, status: "Incorrect Format", error: error.message });
    }
  }

  return response.json({
    success: true,
    total_checked: results.length,
    total_registered: results.filter((result) => result.status === "Registered").length,
    results,
  });
});

app.post("/whatsapp/messages", requireApiKey, sendMessagesHandler);

// Backward-compatible alias for the sample route. This still sends WhatsApp, not SMS.
app.post("/whatsapp/sms", requireApiKey, sendMessagesHandler);

app.use((error, _request, response, _next) => {
  console.error("WhatsApp worker request failed:", error);
  response.status(500).json({ success: false, error: "Internal server error." });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`WhatsApp worker API listening at http://${HOST}:${PORT}`);
  console.log(`OCR API target: ${OCR_API_URL}`);
});

client.initialize().catch((error) => {
  state.status = "initialization_failed";
  state.lastError = error.message;
  console.error("Failed to initialize WhatsApp Web:", error);
});

async function handleIncomingMessage(message, source = "message") {
  const explicitId = explicitMessageId(message);
  let messageKeys = messageIdentityKeys(message);
  let messageId = messageKeys[0] || null;
  recordMessage(message, source, "received", {
    id: messageId,
    idSource: messageIdentitySource(message),
  });

  if (message.from === "status@broadcast") {
    ignoreMessage(message, source, "status_broadcast");
    return;
  }
  if (hasRememberedMessage(messageKeys)) {
    state.messageStats.ignored += 1;
    console.log(`Ignoring WhatsApp message ${messageId} from ${maskChatId(message.from)}: duplicate_event`);
    return;
  }
  if (message.fromMe && (!PROCESS_OWN_MESSAGES || !message.hasMedia)) {
    const reason = PROCESS_OWN_MESSAGES ? "own_non_media_message" : "from_me_disabled";
    state.messageStats.ignored += 1;
    console.log(`Ignoring WhatsApp message ${messageId} from ${maskChatId(message.from)}: ${reason}`);
    return;
  }

  if (!ALLOW_GROUPS && String(message.from || "").endsWith("@g.us")) {
    ignoreMessage(message, source, "group_messages_disabled");
    return;
  }

  if (!message.hasMedia) {
    ignoreMessage(message, source, "no_media");
    await safeReply(message, "Kirim foto KTP atau SIM sebagai gambar untuk diproses otomatis.");
    return;
  }

  if (!explicitId && MISSING_ID_MEDIA_DELAY_MS > 0) {
    recordMessage(message, source, "waiting_for_message_id", {
      waitMs: MISSING_ID_MEDIA_DELAY_MS,
      id: messageId,
      idSource: messageIdentitySource(message),
    });
    await delay(MISSING_ID_MEDIA_DELAY_MS);
    const resolvedMessage = await findRecentMediaMessageWithId(message);
    if (resolvedMessage) {
      message = resolvedMessage;
      recordMessage(message, source, "resolved_message_id", {
        id: messageIdentityKey(message),
        idSource: messageIdentitySource(message),
      });
    }
    messageKeys = messageIdentityKeys(message);
    messageId = messageKeys[0] || messageId;
    if (hasRememberedMessage(messageKeys)) {
      state.messageStats.ignored += 1;
      console.log(`Ignoring WhatsApp message ${messageId || "unknown"} from ${maskChatId(message.from)}: duplicate_event`);
      return;
    }
  }

  markActiveMessage(messageKeys);
  let stage = "downloading_media";
  try {
    recordMessage(message, source, "downloading_media");
    const media = await downloadMessageMedia(message);
    stage = "validating_media";
    if (!media?.data || !media.mimetype?.startsWith("image/")) {
      ignoreMessage(message, source, `unsupported_media:${media?.mimetype || "unknown"}`);
      await safeReply(message, "File tersebut bukan gambar. Kirim foto KTP atau SIM dalam format gambar.");
      return;
    }

    const image = Buffer.from(media.data, "base64");
    if (image.length > MAX_IMAGE_BYTES) {
      ignoreMessage(message, source, "image_too_large");
      await safeReply(message, "Ukuran gambar melebihi batas 20 MB.");
      return;
    }

    stage = "calling_ocr_api";
    recordMessage(message, source, "processing_ocr", {
      mimetype: media.mimetype,
      imageBytes: image.length,
      downloadSource: media.downloadSource || null,
      downloadAttempts: media.downloadAttempts || null,
    });
    const result = await extractIdentityDocument(image, media.mimetype, media.filename);
    let reply = result.formattedText;
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      reply += `\n\nPerlu diperiksa:\n- ${result.warnings.join("\n- ")}`;
    }
    stage = "replying";
    await safeReply(message, reply);
    markProcessedMessage(messageKeys);
    state.messageStats.processed += 1;
    state.messageStats.ocrSucceeded += 1;
    recordMessage(message, source, "processed", {
      documentType: result.documentType || result.fields?.documentType || "UNKNOWN",
      engine: result.engine || null,
    });
  } catch (error) {
    const details = recordFailure(message, source, stage, error);
    state.messageStats.ocrFailed += 1;
    recordMessage(message, source, "failed", { stage, error: details.message, errorName: details.name });
    console.error(`Failed to process WhatsApp message ${messageId || "unknown"} at ${stage}:`, error);
    try {
      await safeReply(
        message,
        "Maaf, foto KTP/SIM belum berhasil diproses. Pastikan layanan OCR aktif lalu kirim ulang foto yang terang, dekat, dan tidak blur.",
      );
    } catch (replyError) {
      state.lastReplyError = {
        at: new Date().toISOString(),
        id: messageId,
        ...errorDetails(replyError),
      };
      console.error(`Failed to send OCR failure reply for ${messageId || "unknown"}:`, replyError);
    }
    state.lastError = details.message;
  } finally {
    unmarkActiveMessage(messageKeys);
  }
}

async function extractIdentityDocument(image, mimetype, originalFilename) {
  const form = new FormData();
  const extension = extensionForMimeType(mimetype);
  const filename = originalFilename || `whatsapp-upload.${extension}`;
  form.append("image", new Blob([image], { type: mimetype }), filename);

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OCR_TIMEOUT_MS);
  try {
    const response = await fetch(`${OCR_API_URL}/api/ocr?mode=auto`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : `HTTP ${response.status}`;
      throw new Error(`OCR API rejected the image: ${detail}`);
    }
    if (!payload.formattedText) {
      throw new Error("OCR API returned no formatted text.");
    }
    return payload;
  } catch (error) {
    if (timedOut || error.name === "AbortError") {
      throw new Error(`OCR API timed out after ${Math.round(OCR_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadMessageMedia(message) {
  const downloadErrors = [];
  let currentMessage = message;

  for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_RETRIES; attempt += 1) {
    try {
      const media = await currentMessage.downloadMedia();
      if (media?.data) {
        media.downloadSource = "whatsapp-web.js";
        media.downloadAttempts = attempt;
        return media;
      }
      downloadErrors.push({
        source: "whatsapp-web.js",
        attempt,
        message: "downloadMedia returned no media data",
      });
    } catch (error) {
      downloadErrors.push({
        source: "whatsapp-web.js",
        attempt,
        ...errorDetails(error),
      });
    }

    if (attempt < MEDIA_DOWNLOAD_RETRIES) {
      await delay(MEDIA_DOWNLOAD_RETRY_DELAY_MS);
      currentMessage = (await reloadOrResolveMessage(currentMessage)) || currentMessage;
    }
  }

  try {
    const media = await downloadMessageMediaDirect(currentMessage);
    media.downloadSource = "direct-decrypt";
    media.downloadAttempts = MEDIA_DOWNLOAD_RETRIES;
    return media;
  } catch (error) {
    downloadErrors.push({
      source: "direct-decrypt",
      ...errorDetails(error),
    });
    const failure = new Error(
      `WhatsApp media download failed after ${MEDIA_DOWNLOAD_RETRIES} attempt(s) and direct fallback.`,
    );
    failure.downloadErrors = downloadErrors;
    failure.mediaSnapshot = redactedMediaSnapshot(currentMessage);
    throw failure;
  }
}

async function reloadOrResolveMessage(message) {
  try {
    if (explicitMessageId(message) && typeof message.reload === "function") {
      const reloaded = await message.reload();
      if (reloaded?.hasMedia) {
        return reloaded;
      }
    }
  } catch (error) {
    console.warn(`Could not reload media message ${messageIdentityKey(message) || "unknown"}:`, error);
  }

  return findRecentMediaMessageWithId(message);
}

async function downloadMessageMediaDirect(message) {
  const snapshot = mediaSnapshot(message);
  if (!snapshot.directPath || !snapshot.mediaKey) {
    throw mediaDownloadError("Direct media fallback is missing directPath or mediaKey.", {
      mediaSnapshot: redactedMediaSnapshot(message),
    });
  }

  const result = await client.pupPage.evaluate(async ({ msgId, snapshot }) => {
    const errorDetails = (error) => ({
      name: error?.name || error?.constructor?.name || "Error",
      message: error?.message ? String(error.message) : String(error || "Unknown error"),
      status: error?.status || null,
      stack: error?.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : null,
    });

    const pick = (msg, field) => {
      const candidates = [
        msg?.[field],
        msg?.mediaData?.[field],
        msg?.mediaData?._mediaData?.[field],
        snapshot?.[field],
      ];
      return candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "") || null;
    };

    try {
      const collection = window.require("WAWebCollections").Msg;
      const msg = msgId
        ? collection.get(msgId) || (await collection.getMessagesById([msgId]))?.messages?.[0] || null
        : null;
      const required = ["directPath", "mediaKey"];
      const payload = {
        directPath: pick(msg, "directPath"),
        encFilehash: pick(msg, "encFilehash"),
        filehash: pick(msg, "filehash"),
        mediaKey: pick(msg, "mediaKey"),
        mediaKeyTimestamp: pick(msg, "mediaKeyTimestamp"),
        type: pick(msg, "type") || "image",
        signal: new AbortController().signal,
        downloadQpl: {
          addAnnotations() {
            return this;
          },
          addPoint() {
            return this;
          },
        },
      };
      const missing = required.filter((field) => !payload[field]);
      if (missing.length > 0) {
        return {
          ok: false,
          error: `Direct media fallback missing ${missing.join(", ")}.`,
          debug: {
            hasMsg: Boolean(msg),
            mediaStage: msg?.mediaData?.mediaStage || null,
            payloadKeys: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Boolean(value)])),
          },
        };
      }

      const decryptedMedia = await window
        .require("WAWebDownloadManager")
        .downloadManager.downloadAndMaybeDecrypt(payload);
      const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);

      return {
        ok: true,
        data,
        mimetype: pick(msg, "mimetype") || snapshot.mimetype || "image/jpeg",
        filename: pick(msg, "filename") || snapshot.filename || null,
        filesize: pick(msg, "size") || snapshot.size || null,
        debug: {
          hasMsg: Boolean(msg),
          mediaStage: msg?.mediaData?.mediaStage || null,
        },
      };
    } catch (error) {
      return { ok: false, error: errorDetails(error), debug: { hasWindowWWebJS: Boolean(window.WWebJS) } };
    }
  }, { msgId: explicitMessageId(message), snapshot });

  if (!result?.ok) {
    throw mediaDownloadError("Direct WhatsApp media decrypt failed.", {
      browserError: result?.error || "No browser result",
      browserDebug: result?.debug || null,
      mediaSnapshot: redactedMediaSnapshot(message),
    });
  }

  return {
    data: result.data,
    mimetype: result.mimetype,
    filename: result.filename,
    filesize: result.filesize,
    browserDebug: result.debug || null,
  };
}

async function sendMessagesHandler(request, response) {
  const phoneNumbers = request.body?.phoneNumbers;
  const message = request.body?.message;
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0 || typeof message !== "string" || !message.trim()) {
    return response.status(400).json({
      success: false,
      error: "phoneNumbers must be a non-empty array and message must be a non-empty string.",
    });
  }
  if (!isReady()) {
    return response.status(503).json({ success: false, error: "WhatsApp client is not ready." });
  }

  const results = [];
  for (const phoneNumber of phoneNumbers) {
    try {
      const { chatId } = normalizePhoneNumber(phoneNumber);
      const sent = await client.sendMessage(chatId, message.trim());
      results.push({ phoneNumber, chatId, status: "Sent", messageId: sent.id?._serialized || null });
    } catch (error) {
      results.push({ phoneNumber, chatId: null, status: "Failed", error: error.message });
    }
  }

  const failed = results.filter((result) => result.status === "Failed").length;
  return response.status(failed === results.length ? 502 : 200).json({
    success: failed === 0,
    total: results.length,
    sent: results.length - failed,
    failed,
    results,
  });
}

function statusPayload() {
  return {
    ...state,
    clientId: CLIENT_ID,
    account: client.info?.wid?.user || null,
    qrAvailable: Boolean(activeQr),
    qrUrl: activeQr ? `http://${HOST}:${PORT}/whatsapp/qr.svg` : null,
    ocrApiUrl: OCR_API_URL,
    ocrTimeoutMs: OCR_TIMEOUT_MS,
    groupsEnabled: ALLOW_GROUPS,
    ownMessagesEnabled: PROCESS_OWN_MESSAGES,
    missingIdMediaDelayMs: MISSING_ID_MEDIA_DELAY_MS,
    mediaDownloadRetries: MEDIA_DOWNLOAD_RETRIES,
    mediaDownloadRetryDelayMs: MEDIA_DOWNLOAD_RETRY_DELAY_MS,
  };
}

function isReady() {
  return state.status === "ready";
}

function normalizePhoneNumber(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Phone number must be a string or number.");
  }
  let number = String(value).replace(/@c\.us$/i, "").replace(/\D/g, "");
  if (number.startsWith("0")) {
    number = `62${number.slice(1)}`;
  } else if (number.startsWith("8")) {
    number = `62${number}`;
  }
  if (number.length < 8 || number.length > 15) {
    throw new Error("Phone number must contain 8 to 15 digits including country code.");
  }
  return { number, chatId: `${number}@c.us` };
}

function requireApiKey(request, response, next) {
  if (!API_KEY) {
    return next();
  }
  const provided = request.get("x-api-key") || "";
  const expectedBuffer = Buffer.from(API_KEY);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return response.status(401).json({ success: false, error: "Invalid x-api-key." });
  }
  return next();
}

async function safeReply(message, text) {
  for (let start = 0; start < text.length; start += 3900) {
    const chunk = text.slice(start, start + 3900);
    try {
      await message.reply(chunk);
    } catch (error) {
      const chatId = message.from || message.to;
      if (!chatId) {
        throw error;
      }
      await client.sendMessage(chatId, chunk);
    }
  }
}

function rememberMessage(messageId) {
  if (!messageId) return;
  processedMessages.add(messageId);
  if (processedMessages.size > 5000) {
    const oldest = processedMessages.values().next().value;
    processedMessages.delete(oldest);
  }
}

function hasRememberedMessage(messageKeys) {
  return messageKeys.some((messageKey) => processedMessages.has(messageKey) || activeMessages.has(messageKey));
}

function markActiveMessage(messageKeys) {
  for (const messageKey of messageKeys) {
    activeMessages.add(messageKey);
  }
}

function unmarkActiveMessage(messageKeys) {
  for (const messageKey of messageKeys) {
    activeMessages.delete(messageKey);
  }
}

function markProcessedMessage(messageKeys) {
  for (const messageKey of messageKeys) {
    rememberMessage(messageKey);
  }
}

function extensionForMimeType(mimetype) {
  if (mimetype.includes("png")) return "png";
  if (mimetype.includes("webp")) return "webp";
  return "jpg";
}

function positiveIntegerEnv(name, defaultValue) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function recordMessage(message, source, status, extra = {}) {
  state.messageStats.events += status === "received" ? 1 : 0;
  const payload = {
    at: new Date().toISOString(),
    source,
    status,
    id: messageIdentityKey(message),
    idSource: messageIdentitySource(message),
    from: maskChatId(message.from),
    to: maskChatId(message.to),
    author: maskChatId(message.author),
    fromMe: Boolean(message.fromMe),
    type: message.type || null,
    hasMedia: Boolean(message.hasMedia),
    ...extra,
  };
  state.lastMessage = payload;
  if (!message.fromMe) {
    state.lastInboundMessage = payload;
  }
}

function ignoreMessage(message, source, reason) {
  state.messageStats.ignored += 1;
  recordMessage(message, source, "ignored", { reason });
  console.log(
    `Ignoring WhatsApp message ${messageIdentityKey(message) || "unknown"} from ${maskChatId(message.from)}: ${reason}`,
  );
}

function messageIdentityKey(message) {
  return messageIdentityKeys(message)[0] || null;
}

function messageIdentityKeys(message) {
  const keys = [];
  const explicitId = explicitMessageId(message);
  if (explicitId) {
    keys.push(`id:${explicitId}`);
  }

  const mediaFingerprint = mediaIdentity(message);
  if (mediaFingerprint) {
    keys.push(`media:${hashText(mediaFingerprint)}`);
  }

  const fallbackParts = [
    message.from || "",
    message.to || "",
    message.author || "",
    message.timestamp || message._data?.t || "",
    message.type || message._data?.type || "",
    message.hasMedia ? "media" : "text",
    mediaFingerprint,
    textIdentity(message),
  ].filter(Boolean);

  if (fallbackParts.length > 0) {
    keys.push(`fallback:${hashText(fallbackParts.join("|"))}`);
  }

  return [...new Set(keys)];
}

function messageIdentitySource(message) {
  if (explicitMessageId(message)) return "message_id";
  if (mediaIdentity(message)) return "media_fingerprint";
  if (textIdentity(message)) return "text_fingerprint";
  return "message_metadata";
}

function recordFailure(message, source, stage, error) {
  const details = errorDetails(error);
  state.lastError = details.message;
  state.lastFailure = {
    at: new Date().toISOString(),
    source,
    stage,
    id: messageIdentityKey(message),
    idSource: messageIdentitySource(message),
    from: maskChatId(message.from),
    to: maskChatId(message.to),
    author: maskChatId(message.author),
    fromMe: Boolean(message.fromMe),
    type: message.type || null,
    hasMedia: Boolean(message.hasMedia),
    ...details,
  };
  return details;
}

function errorDetails(error) {
  const message = error?.message ? String(error.message) : String(error || "Unknown error");
  const stack = error?.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : null;
  const details = {
    name: error?.name || error?.constructor?.name || "Error",
    message,
    stack,
  };
  for (const key of ["downloadErrors", "mediaSnapshot", "browserError", "browserDebug"]) {
    if (error?.[key] !== undefined) {
      details[key] = error[key];
    }
  }
  return details;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findRecentMediaMessageWithId(message) {
  if (explicitMessageId(message) || !message.hasMedia) {
    return null;
  }

  try {
    const chat = await message.getChat();
    const messages = await chat.fetchMessages({ limit: 15 });
    const originalTimestamp = Number(message.timestamp || message._data?.t || 0);
    const originalType = message.type || message._data?.type || "";

    return [...messages].reverse().find((candidate) => {
      if (!candidate?.hasMedia || candidate.fromMe !== message.fromMe || !explicitMessageId(candidate)) {
        return false;
      }
      const candidateTimestamp = Number(candidate.timestamp || candidate._data?.t || 0);
      if (originalTimestamp && candidateTimestamp && Math.abs(candidateTimestamp - originalTimestamp) > 30) {
        return false;
      }
      const candidateType = candidate.type || candidate._data?.type || "";
      return !originalType || !candidateType || originalType === candidateType;
    }) || null;
  } catch (error) {
    console.warn(`Could not resolve media message id for ${messageIdentityKey(message) || "unknown"}:`, error);
    return null;
  }
}

function explicitMessageId(message) {
  const candidates = [
    message.id?._serialized,
    message.id?.id,
    message._data?.id?._serialized,
    message._data?.id?.id,
    message._data?.quotedStanzaID,
    message._data?.stanzaId,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim()) || "";
}

function mediaSnapshot(message) {
  const data = message.rawData || message._data || {};
  return {
    id: explicitMessageId(message),
    directPath: stringValue(data.directPath),
    mediaKey: stringValue(data.mediaKey || message.mediaKey),
    mediaKeyTimestamp: stringValue(data.mediaKeyTimestamp),
    encFilehash: stringValue(data.encFilehash),
    filehash: stringValue(data.filehash),
    type: stringValue(data.type || message.type),
    mimetype: stringValue(data.mimetype),
    filename: stringValue(data.filename),
    size: data.size || null,
    mediaStage: stringValue(data.mediaData?.mediaStage),
  };
}

function redactedMediaSnapshot(message) {
  const snapshot = mediaSnapshot(message);
  return {
    id: snapshot.id || null,
    type: snapshot.type || null,
    mimetype: snapshot.mimetype || null,
    filename: snapshot.filename || null,
    size: snapshot.size || null,
    mediaStage: snapshot.mediaStage || null,
    hasDirectPath: Boolean(snapshot.directPath),
    hasMediaKey: Boolean(snapshot.mediaKey),
    hasMediaKeyTimestamp: Boolean(snapshot.mediaKeyTimestamp),
    hasEncFilehash: Boolean(snapshot.encFilehash),
    hasFilehash: Boolean(snapshot.filehash),
  };
}

function mediaDownloadError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function stringValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function mediaIdentity(message) {
  const data = message._data || {};
  const candidates = [
    data.mediaKey,
    data.filehash,
    data.encFilehash,
    data.directPath,
    data.clientUrl,
    data.deprecatedMms3Url,
    data.mimetype,
    data.size ? String(data.size) : "",
  ];
  return candidates.filter((candidate) => typeof candidate === "string" && candidate.trim()).join("|");
}

function textIdentity(message) {
  const text = message.body || message.caption || message._data?.body || message._data?.caption || "";
  return text ? hashText(String(text).slice(0, 1000)) : "";
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function maskChatId(value) {
  if (!value || typeof value !== "string") return null;
  return value.replace(/\d{7,}/g, (digits) => `${digits.slice(0, 4)}...${digits.slice(-3)}`);
}

function resolveChromePath() {
  const configured = process.env.WHATSAPP_WEB_CHROME_BIN;
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down WhatsApp worker.`);
  server.close();
  await client.destroy().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
