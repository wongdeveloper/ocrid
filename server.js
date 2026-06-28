const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dotenv = require("dotenv");
const express = require("express");
const sharp = require("sharp");
const { createWorker, PSM, setLogging } = require("tesseract.js");
const engData = require("@tesseract.js-data/eng");
const indData = require("@tesseract.js-data/ind");

dotenv.config({ quiet: true });
setLogging(false);

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 6017);
const WEBHOOK_PATH = normalizeRoutePath(process.env.WHATSAPP_WEBHOOK_PATH || "/webhook");
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v23.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MAX_DEDUPED_MESSAGES = 500;

const parser = createKtpParserRuntime();
const processedMessageIds = new Set();

function createServer() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      webhookPath: WEBHOOK_PATH,
      whatsappConfigured: Boolean(ACCESS_TOKEN && PHONE_NUMBER_ID && VERIFY_TOKEN),
    });
  });

  app.get(WEBHOOK_PATH, handleWebhookVerification);
  app.post(WEBHOOK_PATH, express.raw({ type: "*/*", limit: "25mb" }), handleWebhookNotification);

  app.get(["/", "/index.html"], (_req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
  });
  app.get("/app.js", (_req, res) => res.sendFile(path.join(ROOT_DIR, "app.js")));
  app.get("/styles.css", (_req, res) => res.sendFile(path.join(ROOT_DIR, "styles.css")));
  app.use("/node_modules/lucide/dist/umd", express.static(path.join(ROOT_DIR, "node_modules/lucide/dist/umd")));
  app.use("/node_modules/tesseract.js/dist", express.static(path.join(ROOT_DIR, "node_modules/tesseract.js/dist")));
  app.use("/node_modules/tesseract.js-core", express.static(path.join(ROOT_DIR, "node_modules/tesseract.js-core")));
  app.use(
    "/node_modules/@tesseract.js-data",
    express.static(path.join(ROOT_DIR, "node_modules/@tesseract.js-data")),
  );

  return app;
}

function handleWebhookVerification(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    res.status(200).send(String(challenge || ""));
    return;
  }

  res.sendStatus(403);
}

function handleWebhookNotification(req, res) {
  if (!verifyMetaSignature(req.body, req.get("x-hub-signature-256"))) {
    res.sendStatus(401);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch (error) {
    console.error("Invalid WhatsApp webhook JSON:", error.message);
    res.sendStatus(400);
    return;
  }

  res.status(200).json({ ok: true });

  const events = extractWhatsAppMessages(payload);
  events.forEach((event) => {
    handleIncomingWhatsAppMessage(event).catch((error) => {
      console.error("WhatsApp message handling failed:", error);
    });
  });
}

async function handleIncomingWhatsAppMessage({ message, from, phoneNumberId }) {
  if (!from || !message?.id) {
    return;
  }

  if (processedMessageIds.has(message.id)) {
    return;
  }
  rememberMessageId(message.id);

  if (message.type !== "image" || !message.image?.id) {
    await sendWhatsAppText(
      from,
      "Kirim foto KTP sebagai gambar, lalu sistem akan membalas dengan teks hasil OCR.",
      phoneNumberId,
    );
    return;
  }

  try {
    const mediaBuffer = await downloadWhatsAppMedia(message.image.id);
    const result = await recognizeKtpImage(mediaBuffer);
    const reply = result.formattedText.trim() || "Maaf, data KTP belum terbaca jelas. Coba kirim foto yang lebih dekat dan terang.";
    await sendWhatsAppText(from, reply, phoneNumberId);
  } catch (error) {
    console.error("KTP OCR failed:", error);
    await sendWhatsAppText(
      from,
      "Maaf, foto KTP belum berhasil diproses. Coba kirim ulang dengan gambar yang lebih terang dan tidak blur.",
      phoneNumberId,
    );
  }
}

async function downloadWhatsAppMedia(mediaId) {
  assertWhatsAppConfigured();

  const metadata = await graphFetchJson(`${GRAPH_BASE_URL}/${encodeURIComponent(mediaId)}`);
  if (!metadata?.url) {
    throw new Error("WhatsApp media URL was not returned by Graph API");
  }

  const response = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp media download failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function sendWhatsAppText(to, body, sourcePhoneNumberId = "") {
  const senderPhoneNumberId = sourcePhoneNumberId || PHONE_NUMBER_ID;

  if (!ACCESS_TOKEN || !senderPhoneNumberId) {
    console.warn("WhatsApp send skipped because WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing.");
    console.warn(body);
    return { skipped: true };
  }

  const chunks = splitWhatsAppText(body);
  const responses = [];

  for (const chunk of chunks) {
    responses.push(
      await graphFetchJson(`${GRAPH_BASE_URL}/${encodeURIComponent(senderPhoneNumberId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: {
            preview_url: false,
            body: chunk,
          },
        }),
      }),
    );
  }

  return responses;
}

async function graphFetchJson(url, options = {}) {
  if (!ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Graph API request failed (${response.status}): ${JSON.stringify(json).slice(0, 800)}`);
  }

  return json;
}

async function recognizeKtpImage(imageBuffer) {
  const targets = await makeKtpOcrTargets(imageBuffer);
  const language = getOcrLanguage();
  const worker = await createWorker(language.code, 1, {
    langPath: language.langPath,
    gzip: language.gzip,
    cacheMethod: "readOnly",
  });

  try {
    const outputs = [];

    for (const target of targets) {
      await worker.setParameters({
        tessedit_pageseg_mode: target.psm,
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: target.whitelist || "",
        user_defined_dpi: "300",
      });

      const result = await worker.recognize(target.buffer);
      outputs.push({
        label: target.label,
        text: result.data?.text || "",
        confidence: result.data?.confidence || 0,
      });
    }

    const rawText = parser.normalizeRawText(outputs.map((output) => `${output.label}\n${output.text}`).join("\n"));
    const fields = parser.parseKtpText(rawText);
    const formattedText = formatKtpFields(fields);

    return { fields, formattedText, rawText, outputs };
  } finally {
    await worker.terminate();
  }
}

async function makeKtpOcrTargets(imageBuffer) {
  const normalized = await sharp(imageBuffer, { failOn: "none" })
    .rotate()
    .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const card = await cropKtpCard(normalized);

  return [
    {
      label: "Full card",
      buffer: await prepareOcrBuffer(card, "balanced", 1850),
      psm: PSM.SINGLE_BLOCK,
    },
    {
      label: "Sparse card",
      buffer: await prepareOcrBuffer(card, "balanced", 1850),
      psm: PSM.SPARSE_TEXT,
    },
    {
      label: "Left KTP fields",
      buffer: await cropRelativeBuffer(card, { x: 0.02, y: 0.18, width: 0.68, height: 0.66 }, 2.8, "balanced"),
      psm: PSM.SINGLE_BLOCK,
    },
    {
      label: "NIK row",
      buffer: await cropRelativeBuffer(card, { x: 0.21, y: 0.13, width: 0.5, height: 0.09 }, 4.4, "contrast"),
      psm: PSM.SINGLE_LINE,
      whitelist: "0123456789",
    },
    {
      label: "Name row",
      buffer: await cropRelativeBuffer(card, { x: 0.23, y: 0.23, width: 0.45, height: 0.08 }, 4.0, "balanced"),
      psm: PSM.SINGLE_LINE,
    },
    {
      label: "Birth row",
      buffer: await cropRelativeBuffer(card, { x: 0.22, y: 0.28, width: 0.48, height: 0.08 }, 4.0, "balanced"),
      psm: PSM.SINGLE_LINE,
    },
    {
      label: "Address row",
      buffer: await cropRelativeBuffer(card, { x: 0.22, y: 0.36, width: 0.48, height: 0.1 }, 4.0, "balanced"),
      psm: PSM.SINGLE_LINE,
    },
    {
      label: "RT village district",
      buffer: await cropRelativeBuffer(card, { x: 0.12, y: 0.42, width: 0.5, height: 0.16 }, 3.7, "balanced"),
      psm: PSM.SINGLE_BLOCK,
    },
    {
      label: "Religion row",
      buffer: await cropRelativeBuffer(card, { x: 0.2, y: 0.56, width: 0.25, height: 0.07 }, 4.0, "balanced"),
      psm: PSM.SINGLE_LINE,
    },
    {
      label: "Header city",
      buffer: await cropRelativeBuffer(card, { x: 0.28, y: 0.02, width: 0.48, height: 0.13 }, 3.2, "balanced"),
      psm: PSM.SINGLE_BLOCK,
    },
  ];
}

async function cropKtpCard(imageBuffer) {
  const image = sharp(imageBuffer);
  const { data, info } = await image.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = detectKtpCardBounds(data, info);

  if (!bounds) {
    return imageBuffer;
  }

  return image.extract(bounds).png().toBuffer();
}

function detectKtpCardBounds(data, info) {
  const { width, height, channels } = info;
  const step = Math.max(3, Math.round(Math.max(width, height) / 420));
  const rowScores = new Array(Math.ceil(height / step)).fill(0);
  const colScores = new Array(Math.ceil(width / step)).fill(0);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * channels;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = (r + g + b) / 3;
      const blueCard = b > r * 0.82 && g > r * 0.82;
      const brightCard = brightness > 118 && Math.max(r, g, b) - Math.min(r, g, b) < 95;

      if (blueCard || brightCard) {
        rowScores[Math.floor(y / step)] += 1;
        colScores[Math.floor(x / step)] += 1;
      }
    }
  }

  const rowBand = findStrongBand(rowScores, Math.max(12, (width / step) * 0.22));
  const colBand = findStrongBand(colScores, Math.max(12, (height / step) * 0.18));

  if (!rowBand || !colBand) {
    return null;
  }

  const marginX = Math.round(width * 0.015);
  const marginY = Math.round(height * 0.015);
  const left = clampNumber(colBand.start * step - marginX, 0, width - 1);
  const top = clampNumber(rowBand.start * step - marginY, 0, height - 1);
  const right = clampNumber((colBand.end + 1) * step + marginX, left + 1, width);
  const bottom = clampNumber((rowBand.end + 1) * step + marginY, top + 1, height);
  const areaRatio = ((right - left) * (bottom - top)) / (width * height);

  if (areaRatio < 0.12) {
    return null;
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

function findStrongBand(scores, threshold) {
  let best = null;
  let current = null;

  scores.forEach((score, index) => {
    if (score >= threshold) {
      if (!current) {
        current = { start: index, end: index, total: 0 };
      }

      current.end = index;
      current.total += score;
      return;
    }

    if (current && (!best || current.total > best.total)) {
      best = current;
    }
    current = null;
  });

  if (current && (!best || current.total > best.total)) {
    best = current;
  }

  return best;
}

async function cropRelativeBuffer(imageBuffer, rect, scale, mode) {
  const metadata = await sharp(imageBuffer).metadata();
  const left = clampNumber(Math.round(metadata.width * rect.x), 0, metadata.width - 1);
  const top = clampNumber(Math.round(metadata.height * rect.y), 0, metadata.height - 1);
  const width = clampNumber(Math.round(metadata.width * rect.width), 1, metadata.width - left);
  const height = clampNumber(Math.round(metadata.height * rect.height), 1, metadata.height - top);
  const crop = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  return prepareOcrBuffer(crop, mode, Math.round(width * scale));
}

async function prepareOcrBuffer(imageBuffer, mode, width) {
  let image = sharp(imageBuffer, { failOn: "none" }).rotate();

  if (width) {
    image = image.resize({ width, withoutEnlargement: false });
  }

  image = image.grayscale().normalize().sharpen();

  if (mode === "contrast") {
    image = image.linear(1.45, -22).threshold(158);
  }

  return image.png().toBuffer();
}

function formatKtpFields(fields) {
  if (fields.documentType === "SIM") {
    const bloodGender = [parser.formatTitlePart(fields.bloodType), parser.formatTitlePart(fields.gender)]
      .filter(Boolean)
      .join(" / ");
    return [
      parser.formatTitlePart(fields.name),
      parser.formatPlainPart(fields.licenseNumber),
      parser.formatTitlePart(fields.licenseClass).replace(/\bSim\b/g, "SIM"),
      formatBirth(fields.birth),
      bloodGender,
      parser.formatAddressPart(fields.address),
      parser.formatTitlePart(fields.job),
      parser.cleanExportValue(fields.validUntil),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const addressLine = [
    parser.formatAddressPart(fields.address),
    parser.formatPlainPart(fields.rtRw),
    parser.formatTitlePart(fields.village),
    parser.formatTitlePart(fields.district),
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    parser.formatTitlePart(fields.name),
    parser.normalizeDigits(fields.nik),
    formatBirth(fields.birth),
    parser.formatTitlePart(fields.religion),
    addressLine,
    parser.formatRegion(fields.city),
  ];

  return lines.some((line) => line.trim()) ? lines.join("\n") : "";
}

function formatBirth(value) {
  const cleaned = parser.cleanExportValue(value);
  const separatorIndex = cleaned.indexOf(",");

  if (separatorIndex === -1) {
    return parser.formatTitlePart(cleaned);
  }

  const place = cleaned.slice(0, separatorIndex);
  const date = cleaned.slice(separatorIndex + 1);
  return [parser.formatTitlePart(place), parser.cleanExportValue(date)].filter(Boolean).join(", ");
}

function createKtpParserRuntime() {
  const source = fs.readFileSync(path.join(ROOT_DIR, "app.js"), "utf8");
  const context = {
    console,
    Uint8ClampedArray,
    URL,
    Blob: function BlobStub() {},
    Image: function ImageStub() {},
    FileReader: function FileReaderStub() {},
    navigator: {
      clipboard: {
        writeText: async () => {},
      },
    },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") {
        callback();
      }
    },
    setTimeout() {},
  };

  context.window = {
    location: { href: "http://localhost/" },
    lucide: null,
    Tesseract: { PSM },
    setTimeout() {},
  };
  context.document = {
    body: createNoopElement(),
    createElement: createNoopElement,
    querySelector: createNoopElement,
    querySelectorAll: () => [],
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: "app.js" });

  return {
    parseKtpText: context.parseIdentityText,
    normalizeRawText: context.normalizeRawText,
    formatAddressPart: context.formatAddressPart,
    formatPlainPart: context.formatPlainPart,
    formatTitlePart: context.formatTitlePart,
    formatRegion: context.formatRegion,
    normalizeDigits: context.normalizeDigits,
    cleanExportValue: context.cleanExportValue,
  };
}

function createNoopElement() {
  return {
    addEventListener() {},
    append() {},
    click() {},
    remove() {},
    setAttribute() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    dataset: {},
    disabled: false,
    height: 1,
    innerHTML: "",
    scrollTop: 0,
    style: {},
    textContent: "",
    value: "",
    width: 1,
    getContext() {
      return createNoopCanvasContext();
    },
  };
}

function createNoopCanvasContext() {
  return {
    beginPath() {},
    clearRect() {},
    closePath() {},
    drawImage() {},
    fillRect() {},
    fillText() {},
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
    moveTo() {},
    putImageData() {},
    restore() {},
    rotate() {},
    save() {},
    setLineDash() {},
    stroke() {},
    translate() {},
    arcTo() {},
  };
}

function extractWhatsAppMessages(payload) {
  const messages = [];

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || PHONE_NUMBER_ID;

      for (const message of value.messages || []) {
        messages.push({
          message,
          from: message.from,
          phoneNumberId,
        });
      }
    }
  }

  return messages;
}

function verifyMetaSignature(rawBody, signatureHeader) {
  if (!META_APP_SECRET) {
    return true;
  }

  if (!signatureHeader || !Buffer.isBuffer(rawBody)) {
    return false;
  }

  const expected = `sha256=${crypto.createHmac("sha256", META_APP_SECRET).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signatureHeader, "utf8");

  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function rememberMessageId(id) {
  processedMessageIds.add(id);

  if (processedMessageIds.size <= MAX_DEDUPED_MESSAGES) {
    return;
  }

  const first = processedMessageIds.values().next().value;
  processedMessageIds.delete(first);
}

function splitWhatsAppText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return ["Maaf, hasil OCR kosong."];
  }

  const chunks = [];
  for (let index = 0; index < value.length; index += 3900) {
    chunks.push(value.slice(index, index + 3900));
  }

  return chunks;
}

function getOcrLanguage() {
  const language = String(process.env.OCR_LANGUAGE || "ind").toLowerCase();

  if (language === "eng") {
    return engData;
  }

  return indData;
}

function assertWhatsAppConfigured() {
  if (!ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  }
}

function normalizeRoutePath(value) {
  const route = String(value || "").trim();

  if (!route) {
    return "/webhook";
  }

  return route.startsWith("/") ? route : `/${route}`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`KTP OCR app listening on http://localhost:${PORT}`);
    console.log(`WhatsApp webhook endpoint: http://localhost:${PORT}${WEBHOOK_PATH}`);
  });
}

module.exports = {
  createServer,
  formatKtpFields,
  recognizeKtpImage,
};
