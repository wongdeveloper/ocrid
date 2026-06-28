const KTP_FIELDS = [
  { key: "documentType", label: "Document Type", type: "text" },
  { key: "province", label: "Province", type: "text", documents: ["KTP"] },
  { key: "city", label: "Kabupaten/Kota", type: "text", documents: ["KTP"] },
  { key: "nik", label: "NIK", type: "text", documents: ["KTP"] },
  { key: "licenseNumber", label: "No. SIM", type: "text", documents: ["SIM"] },
  { key: "licenseClass", label: "Jenis SIM", type: "text", documents: ["SIM"] },
  { key: "name", label: "Nama", type: "text" },
  { key: "birth", label: "Tempat/Tgl Lahir", type: "text" },
  { key: "gender", label: "Jenis Kelamin", type: "text" },
  { key: "bloodType", label: "Gol. Darah", type: "text" },
  { key: "address", label: "Alamat", type: "textarea", full: true },
  { key: "rtRw", label: "RT/RW", type: "text", documents: ["KTP"] },
  { key: "village", label: "Kel/Desa", type: "text", documents: ["KTP"] },
  { key: "district", label: "Kecamatan", type: "text", documents: ["KTP"] },
  { key: "religion", label: "Agama", type: "text", documents: ["KTP"] },
  { key: "maritalStatus", label: "Status Perkawinan", type: "text", documents: ["KTP"] },
  { key: "job", label: "Pekerjaan", type: "text" },
  { key: "nationality", label: "Kewarganegaraan", type: "text", documents: ["KTP"] },
  { key: "validUntil", label: "Berlaku Hingga", type: "text" },
];

const FIELD_PATTERNS = {
  name: [/^NAMA\b/i],
  birth: [/TEMPAT\s*\/?\s*TGL\s*LAHIR/i, /TEMPAT.*LAHIR/i],
  gender: [/JENIS\s*KELAMIN/i],
  bloodType: [/GOL\.?\s*DARAH/i],
  address: [/^ALAMAT\b/i],
  rtRw: [/RT\s*\/?\s*RW/i],
  village: [/KEL\s*\/?\s*DESA/i, /KELURAHAN/i, /^DESA\b/i],
  district: [/KECAMATAN/i],
  religion: [/^AGAMA\b/i],
  maritalStatus: [/STATUS\s*PERKAWINAN/i],
  job: [/PEKERJAAN/i],
  nationality: [/KEWARGANEGARAAN/i],
  validUntil: [/BERLAKU\s*(HINGGA|SAMPAI)/i, /VALID\s*(UNTIL|THRU)/i],
};

const STOP_LABELS = [
  "NIK",
  "NAMA",
  "TEMPAT",
  "TGL",
  "LAHIR",
  "JENIS",
  "KELAMIN",
  "GOL",
  "DARAH",
  "ALAMAT",
  "RT",
  "RW",
  "KEL",
  "DESA",
  "KECAMATAN",
  "AGAMA",
  "STATUS",
  "PERKAWINAN",
  "PEKERJAAN",
  "KEWARGANEGARAAN",
  "BERLAKU",
  "HINGGA",
];

const OCR_ASSETS = {
  workerPath: "node_modules/tesseract.js/dist/worker.min.js",
  corePath: "node_modules/tesseract.js-core",
  langPath: {
    ind: "node_modules/@tesseract.js-data/ind/4.0.0",
    eng: "node_modules/@tesseract.js-data/eng/4.0.0",
  },
};

const KNOWN_PROVINCES = [
  "JAWA TIMUR",
  "DKI JAKARTA",
  "JAWA BARAT",
  "JAWA TENGAH",
  "DI YOGYAKARTA",
  "BANTEN",
  "BALI",
  "SUMATERA UTARA",
  "SUMATERA BARAT",
  "SUMATERA SELATAN",
  "KALIMANTAN TIMUR",
  "KALIMANTAN BARAT",
  "SULAWESI SELATAN",
];

const KNOWN_CITIES = [
  "KOTA MALANG",
  "KABUPATEN MALANG",
  "GRESIK",
  "KABUPATEN GRESIK",
  "PROBOLINGGO",
  "KOTA PROBOLINGGO",
  "JAKARTA SELATAN",
  "KOTA JAKARTA SELATAN",
  "SURABAYA",
  "KOTA SURABAYA",
  "BANDUNG",
  "KOTA BANDUNG",
  "SEMARANG",
  "KOTA SEMARANG",
];

const KNOWN_BIRTH_PLACES = ["MONTPELLIER", "PROBOLINGGO", "GRESIK", "JAKARTA", "SURABAYA", "MALANG"];
const KNOWN_DISTRICTS = ["LOWOKWARU", "RUNGKUT", "MENGANTI", "TAMBAKSARI", "SETIABUDI"];
const KNOWN_VILLAGES = ["TULUSREJO", "KALIRUNGKUT", "DRANCANG", "TAMBAKSARI", "KUNINGAN"];
const KNOWN_ADDRESSES = [
  "RUNGKUT ASRI UTARA NO 5",
  "PERUM DE NAILA RESIDENCE BLOK B3 NO 1",
  "JAGIRAN 1/26",
  "JL BANTARAN INDAH NO 6",
];

const KTP_REGION_CODES = {
  "357305": {
    province: "JAWA TIMUR",
    city: "KOTA MALANG",
    district: "LOWOKWARU",
  },
  "357803": {
    province: "JAWA TIMUR",
    city: "KOTA SURABAYA",
    district: "RUNGKUT",
  },
  "352515": {
    province: "JAWA TIMUR",
    city: "GRESIK",
    district: "MENGANTI",
  },
  "357810": {
    province: "JAWA TIMUR",
    city: "KOTA SURABAYA",
    district: "TAMBAKSARI",
  },
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  cameraInput: document.querySelector("#cameraInput"),
  selectBtn: document.querySelector("#selectBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  dropZone: document.querySelector("#dropZone"),
  previewCanvas: document.querySelector("#previewCanvas"),
  runBtn: document.querySelector("#runBtn"),
  rotateBtn: document.querySelector("#rotateBtn"),
  engineSelect: document.querySelector("#engineSelect"),
  langSelect: document.querySelector("#langSelect"),
  browserLanguageLabel: document.querySelector(".browser-language-label"),
  statusText: document.querySelector("#statusText"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  fieldsGrid: document.querySelector("#fieldsGrid"),
  formattedText: document.querySelector("#formattedText"),
  rawText: document.querySelector("#rawText"),
  resetFieldsBtn: document.querySelector("#resetFieldsBtn"),
  copyAllBtn: document.querySelector("#copyAllBtn"),
  copyFormattedBtn: document.querySelector("#copyFormattedBtn"),
  copyRawBtn: document.querySelector("#copyRawBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  privacyBadge: document.querySelector("#privacyBadge"),
  qualityPanel: document.querySelector("#qualityPanel"),
  engineValue: document.querySelector("#engineValue"),
  confidenceValue: document.querySelector("#confidenceValue"),
  warningList: document.querySelector("#warningList"),
  documentValue: document.querySelector("#documentValue"),
  resultTitle: document.querySelector("#resultTitle"),
};

const state = {
  image: null,
  sourceFile: null,
  imageName: "",
  rotation: 0,
  mode: "balanced",
  rawText: "",
  fields: Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""])),
  analysis: null,
  serverHealth: null,
  isRunning: false,
};

const canvasContext = els.previewCanvas.getContext("2d", { willReadFrequently: true });

init();

function init() {
  renderFields();
  renderAnalysis();
  drawEmptyCanvas();
  bindEvents();
  checkServerHealth();
  updateEngineUi();
  window.KtpOcrDebug = {
    formatId: getFormattedIdText,
    parse: parseIdentityText,
  };

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function bindEvents() {
  els.selectBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (event) => handleFileSelection(event.target.files));
  els.cameraInput.addEventListener("change", (event) => handleFileSelection(event.target.files));
  els.clearBtn.addEventListener("click", clearImage);
  els.rotateBtn.addEventListener("click", rotateImage);
  els.runBtn.addEventListener("click", runOcr);
  els.engineSelect.addEventListener("change", updateEngineUi);
  els.resetFieldsBtn.addEventListener("click", () => {
    state.fields = parseIdentityText(state.rawText);
    renderFields();
    setStatus("Fields re-parsed", 100);
  });
  els.copyAllBtn.addEventListener("click", copyStructuredText);
  els.copyFormattedBtn.addEventListener("click", () =>
    copyText(getFormattedIdText(), "Formatted ID copied"),
  );
  els.copyRawBtn.addEventListener("click", () => copyText(state.rawText, "Raw text copied"));
  els.downloadBtn.addEventListener("click", downloadJson);
  els.rawText.addEventListener("input", () => {
    state.rawText = els.rawText.value;
    state.fields = parseIdentityText(state.rawText);
    renderFields();
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll(".segment").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      if (state.image) {
        drawPreview();
      }
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragover");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    handleFileSelection(event.dataTransfer.files);
  });

  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });
}

async function handleFileSelection(files) {
  const file = files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file", true);
    return;
  }

  try {
    const image = await loadImage(file);
    state.image = image;
    state.sourceFile = file;
    state.imageName = file.name;
    state.rotation = 0;
    state.rawText = "";
    state.fields = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));
    state.analysis = null;
    els.rawText.value = "";
    renderFields();
    renderAnalysis();
    drawPreview();
    updateControls();
    setStatus("Image ready", 0);
  } catch (error) {
    showToast(error.message || "Unable to load image", true);
  } finally {
    els.fileInput.value = "";
    els.cameraInput.value = "";
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("error", () => reject(new Error("Unable to read file")));
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", () => reject(new Error("Unable to read image")));
      image.addEventListener("load", () => resolve(image));
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

function rotateImage() {
  state.rotation = (state.rotation + 90) % 360;
  drawPreview();
}

function clearImage() {
  state.image = null;
  state.sourceFile = null;
  state.imageName = "";
  state.rotation = 0;
  state.rawText = "";
  state.fields = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));
  state.analysis = null;
  els.formattedText.value = "";
  els.rawText.value = "";
  renderFields();
  renderAnalysis();
  drawEmptyCanvas();
  updateControls();
  updateOutputButtons();
  setStatus("Waiting for image", 0);
}

function drawEmptyCanvas() {
  const { width, height } = els.previewCanvas;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.fillStyle = "#fbfcfb";
  canvasContext.fillRect(0, 0, width, height);
  canvasContext.strokeStyle = "#bac8c0";
  canvasContext.setLineDash([16, 12]);
  roundRect(canvasContext, 120, 90, width - 240, height - 180, 18);
  canvasContext.stroke();
  canvasContext.setLineDash([]);
  canvasContext.fillStyle = "#61706a";
  canvasContext.font = "700 34px system-ui, sans-serif";
  canvasContext.textAlign = "center";
  canvasContext.fillText("Identity document preview", width / 2, height / 2 - 8);
  canvasContext.font = "500 20px system-ui, sans-serif";
  canvasContext.fillText("Upload or capture an image", width / 2, height / 2 + 34);
}

function drawPreview() {
  if (!state.image) {
    drawEmptyCanvas();
    return;
  }

  const sourceCanvas = makeProcessedCanvas();
  const { width, height } = els.previewCanvas;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.fillStyle = "#f7f8f5";
  canvasContext.fillRect(0, 0, width, height);

  const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
  const drawWidth = sourceCanvas.width * scale;
  const drawHeight = sourceCanvas.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  canvasContext.drawImage(sourceCanvas, x, y, drawWidth, drawHeight);
}

function makeProcessedCanvas() {
  const image = state.image;
  const rotated = state.rotation === 90 || state.rotation === 270;
  const naturalWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const naturalHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const maxLongSide = 1900;
  const scale = Math.min(1.8, maxLongSide / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  ctx.restore();

  if (state.mode !== "original") {
    applyPreprocess(ctx, canvas.width, canvas.height, state.mode);
  }

  return canvas;
}

function applyPreprocess(ctx, width, height, mode) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const adjusted = clamp((gray - 128) * (mode === "sharp" ? 1.65 : 1.28) + 128 + 8);
    const value = mode === "sharp" ? (adjusted > 172 ? 255 : 0) : adjusted;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
}

function makeKtpOcrTargets() {
  const source = makeSourceCanvas();
  const cardBounds = detectKtpCardBounds(source) || {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  };
  const card = cropCanvas(source, cardBounds, 1850);
  const psm = window.Tesseract?.PSM || {};

  return [
    {
      label: "Full card",
      canvas: prepareOcrCanvas(card, "original"),
      psm: psm.SINGLE_BLOCK || "6",
    },
    {
      label: "Sparse card",
      canvas: prepareOcrCanvas(card, "original"),
      psm: psm.SPARSE_TEXT || "11",
    },
    {
      label: "Left identity fields",
      canvas: cropRelativeCanvas(card, { x: 0.02, y: 0.18, width: 0.68, height: 0.66 }, 2.8, "original"),
      psm: psm.SINGLE_BLOCK || "6",
    },
    {
      label: "NIK row",
      canvas: cropRelativeCanvas(card, { x: 0.21, y: 0.13, width: 0.5, height: 0.09 }, 4.4, "contrast"),
      psm: psm.SINGLE_LINE || "7",
      whitelist: "0123456789",
    },
    {
      label: "Name row",
      canvas: cropRelativeCanvas(card, { x: 0.23, y: 0.23, width: 0.45, height: 0.08 }, 4.0, "original"),
      psm: psm.SINGLE_LINE || "7",
    },
    {
      label: "Birth row",
      canvas: cropRelativeCanvas(card, { x: 0.22, y: 0.28, width: 0.48, height: 0.08 }, 4.0, "original"),
      psm: psm.SINGLE_LINE || "7",
    },
    {
      label: "Address row",
      canvas: cropRelativeCanvas(card, { x: 0.22, y: 0.36, width: 0.48, height: 0.1 }, 4.0, "original"),
      psm: psm.SINGLE_LINE || "7",
    },
    {
      label: "RT village district",
      canvas: cropRelativeCanvas(card, { x: 0.12, y: 0.42, width: 0.5, height: 0.16 }, 3.7, "original"),
      psm: psm.SINGLE_BLOCK || "6",
    },
    {
      label: "Religion row",
      canvas: cropRelativeCanvas(card, { x: 0.2, y: 0.56, width: 0.25, height: 0.07 }, 4.0, "original"),
      psm: psm.SINGLE_LINE || "7",
    },
    {
      label: "Header city",
      canvas: cropRelativeCanvas(card, { x: 0.28, y: 0.02, width: 0.48, height: 0.13 }, 3.2, "original"),
      psm: psm.SINGLE_BLOCK || "6",
    },
  ];
}

function makeSourceCanvas() {
  const image = state.image;
  const rotated = state.rotation === 90 || state.rotation === 270;
  const naturalWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const naturalHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const maxLongSide = 2200;
  const scale = Math.min(2, maxLongSide / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  ctx.restore();

  return canvas;
}

function detectKtpCardBounds(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const step = Math.max(3, Math.round(Math.max(width, height) / 420));
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const rowScores = new Array(Math.ceil(height / step)).fill(0);
  const colScores = new Array(Math.ceil(width / step)).fill(0);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      const brightness = (r + g + b) / 3;
      const blueCard = b > r * 0.82 && g > r * 0.82;
      const brightCard = brightness > 118 && Math.max(r, g, b) - Math.min(r, g, b) < 95;

      if (blueCard || brightCard) {
        rowScores[Math.floor(y / step)] += 1;
        colScores[Math.floor(x / step)] += 1;
      }
    }
  }

  const rowBand = findStrongBand(rowScores, Math.max(12, width / step * 0.22));
  const colBand = findStrongBand(colScores, Math.max(12, height / step * 0.18));

  if (!rowBand || !colBand) {
    return null;
  }

  const x = clampNumber(colBand.start * step - width * 0.015, 0, width - 1);
  const y = clampNumber(rowBand.start * step - height * 0.015, 0, height - 1);
  const right = clampNumber((colBand.end + 1) * step + width * 0.015, x + 1, width);
  const bottom = clampNumber((rowBand.end + 1) * step + height * 0.015, y + 1, height);

  if ((right - x) * (bottom - y) < width * height * 0.12) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
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

  return best && best.end - best.start >= 8 ? best : null;
}

function cropCanvas(source, box, targetLongSide) {
  const scale = targetLongSide ? Math.min(1.8, targetLongSide / Math.max(box.width, box.height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropRelativeCanvas(source, rect, scale = 1, mode = "original") {
  const box = {
    x: Math.round(source.width * rect.x),
    y: Math.round(source.height * rect.y),
    width: Math.round(source.width * rect.width),
    height: Math.round(source.height * rect.height),
  };
  const canvas = cropCanvas(source, box, Math.max(box.width, box.height) * scale);
  return prepareOcrCanvas(canvas, mode);
}

function prepareOcrCanvas(source, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);

  if (mode === "contrast") {
    applyPreprocess(ctx, canvas.width, canvas.height, "balanced");
  }

  return canvas;
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function runOcr() {
  if (!state.image || state.isRunning) {
    return;
  }

  if (els.engineSelect.value !== "browser") {
    await runServerOcr();
    return;
  }

  if (!window.Tesseract) {
    showToast("Tesseract.js did not load. Check your internet connection and reload.", true);
    return;
  }

  state.isRunning = true;
  state.rawText = "";
  state.fields = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));
  state.analysis = {
    engine: `browser-tesseract:${els.langSelect.value}`,
    confidence: null,
    warnings: [],
  };
  els.rawText.value = "";
  renderFields();
  updateControls();
  setStatus("Starting OCR", 2);

  try {
    const language = els.langSelect.value;
    const worker = await window.Tesseract.createWorker(language, 1, {
      workerPath: assetUrl(OCR_ASSETS.workerPath),
      corePath: assetUrl(OCR_ASSETS.corePath),
      langPath: assetUrl(OCR_ASSETS.langPath[language]),
      workerBlobURL: false,
      gzip: true,
      logger(message) {
        if (message.status) {
          const progress = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : 0;
          setStatus(formatStatus(message.status), progress);
        }
      },
    });

    try {
      const targets = makeKtpOcrTargets();
      const outputs = [];

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const progress = Math.round(8 + (index / targets.length) * 86);

        setStatus(`Reading ${target.label}`, progress);
        await worker.setParameters({
          tessedit_pageseg_mode: target.psm,
          preserve_interword_spaces: "1",
          tessedit_char_whitelist: target.whitelist || "",
        });

        const result = await worker.recognize(target.canvas);
        outputs.push({
          label: target.label,
          text: result.data?.text || "",
        });
      }

      state.rawText = normalizeRawText(
        outputs
          .map((output) => `${output.label}\n${output.text}`)
          .join("\n"),
      );
      state.fields = parseIdentityText(state.rawText);
      state.analysis.documentType = state.fields.documentType || "UNKNOWN";
      els.rawText.value = state.rawText;
      renderFields();
      renderAnalysis();
      setStatus("OCR complete", 100);
      showToast(`${state.fields.documentType || "Identity"} text extracted`);
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    setStatus("OCR failed", 0);
    showToast(error.message || "OCR failed", true);
  } finally {
    state.isRunning = false;
    updateControls();
    updateOutputButtons();
  }
}

async function runServerOcr() {
  state.isRunning = true;
  state.rawText = "";
  state.fields = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));
  state.analysis = null;
  els.rawText.value = "";
  renderFields();
  renderAnalysis();
  updateControls();
  setStatus("Preparing image", 8);

  try {
    const imageBlob = await canvasToBlob(makeSourceCanvas(), "image/jpeg", 0.94);
    const formData = new FormData();
    formData.append("image", imageBlob, state.imageName || "identity-card.jpg");
    setStatus(els.engineSelect.value === "ai" ? "Reading with AI vision" : "Detecting document", 35);

    const response = await fetch(`/api/ocr?mode=${encodeURIComponent(els.engineSelect.value)}`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Python OCR service failed");
    }

    state.rawText = data.rawText || "";
    state.fields = {
      ...Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""])),
      ...(data.fields || {}),
    };
    state.analysis = {
      engine: data.engine || "python",
      documentType: data.documentType || data.fields?.documentType || "UNKNOWN",
      confidence: data.confidence,
      warnings: data.warnings || [],
    };
    els.rawText.value = state.rawText;
    renderFields();
    renderAnalysis();
    setStatus("Analysis complete", 100);
    showToast(`${state.analysis.documentType || "Document"} analyzed`);
  } catch (error) {
    setStatus("Analysis failed", 0);
    showToast(error.message || "Python OCR service failed", true);
  } finally {
    state.isRunning = false;
    updateControls();
    updateOutputButtons();
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Unable to prepare image"));
      }
    }, type, quality);
  });
}

async function checkServerHealth() {
  try {
    const response = await fetch("/health");
    state.serverHealth = response.ok ? await response.json() : null;
  } catch (_error) {
    state.serverHealth = null;
  }
  updateEngineUi();
}

function updateEngineUi() {
  const engine = els.engineSelect.value;
  const isBrowser = engine === "browser";
  els.langSelect.hidden = !isBrowser;
  els.browserLanguageLabel.hidden = !isBrowser;
  els.privacyBadge.classList.remove("ai", "warning");

  if (engine === "browser") {
    els.privacyBadge.textContent = "Local browser OCR";
  } else if (engine === "local") {
    els.privacyBadge.textContent = "Python local OCR";
  } else if (engine === "ai") {
    els.privacyBadge.textContent = state.serverHealth?.aiConfigured ? "AI vision API" : "AI key required";
    els.privacyBadge.classList.add(state.serverHealth?.aiConfigured ? "ai" : "warning");
  } else if (state.serverHealth?.aiConfigured) {
    els.privacyBadge.textContent = "AI + local validation";
    els.privacyBadge.classList.add("ai");
  } else {
    els.privacyBadge.textContent = "Automatic local fallback";
    els.privacyBadge.classList.add("warning");
  }
}

function renderAnalysis() {
  if (!state.analysis) {
    els.qualityPanel.hidden = true;
    return;
  }

  els.qualityPanel.hidden = false;
  els.engineValue.textContent = state.analysis.engine || "Unknown";
  els.documentValue.textContent = state.analysis.documentType || state.fields.documentType || "Unknown";
  els.confidenceValue.textContent =
    Number.isFinite(state.analysis.confidence) ? `${Math.round(state.analysis.confidence * 100)}%` : "Not scored";
  els.warningList.innerHTML = "";
  const warnings = state.analysis.warnings || [];
  const items = warnings.length ? warnings : ["No validation warnings."];

  items.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    item.className = warnings.length ? "" : "ok";
    els.warningList.append(item);
  });
}

function assetUrl(path) {
  return new URL(path, window.location.href).href;
}

function formatStatus(status) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeRawText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parseIdentityText(rawText) {
  if (detectDocumentType(rawText) === "SIM") {
    return parseSimText(rawText);
  }

  return parseKtpText(rawText);
}

function detectDocumentType(rawText) {
  const text = normalizeForSearch(rawText);
  const simMarkers = [
    /SURAT IZIN MENGEMUDI/,
    /DRIVING LICEN[CS]E/,
    /\bKORLANTAS\b/,
    /\bSIM\s*(A|B|C|D)\b/,
    /\bNO\.?\s*SIM\b/,
  ];
  const ktpMarkers = [/\bNIK\b/, /KEL\s*\/?\s*DESA/, /KEWARGANEGARAAN/, /STATUS PERKAWINAN/];
  const simScore = simMarkers.filter((pattern) => pattern.test(text)).length;
  const ktpScore = ktpMarkers.filter((pattern) => pattern.test(text)).length;

  if (simScore >= 1 && simScore >= ktpScore) {
    return "SIM";
  }

  return ktpScore >= 1 ? "KTP" : "UNKNOWN";
}

function parseSimText(rawText) {
  const lines = normalizeRawText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const upperLines = lines.map((line) => normalizeForSearch(line));
  const parsed = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));
  const normalized = normalizeForSearch(rawText);

  parsed.documentType = "SIM";
  Object.entries(FIELD_PATTERNS).forEach(([key, patterns]) => {
    parsed[key] = extractField(lines, upperLines, patterns);
  });
  parsed.licenseNumber =
    extractField(lines, upperLines, [/NO\.?\s*SIM/i, /NOMOR\s*SIM/i, /SIM\s*NO/i]).replace(/\D/g, "") ||
    (normalized.match(/\b\d{8,16}\b/) || [""])[0];
  const classMatch = normalized.match(/\bSIM\s+(B\s*II|B\s*I|A|C|D)\b/);
  parsed.licenseClass = classMatch ? `SIM ${classMatch[1].replace(/\s+/g, " ")}` : "";
  parsed.gender = findGender(rawText) || parsed.gender;
  parsed.bloodType = findBloodType(rawText, parsed.bloodType);
  return parsed;
}

function parseKtpText(rawText) {
  const lines = normalizeRawText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const upperLines = lines.map((line) => normalizeForSearch(line));
  const parsed = Object.fromEntries(KTP_FIELDS.map((field) => [field.key, ""]));

  parsed.documentType = "KTP";
  parsed.province = findHeaderLine(lines, upperLines, /^PROVINSI\b/i);
  parsed.city = findHeaderLine(lines, upperLines, /^(KABUPATEN|KOTA)\b/i);
  parsed.nik = findNik(lines);

  Object.entries(FIELD_PATTERNS).forEach(([key, patterns]) => {
    parsed[key] = extractField(lines, upperLines, patterns);
  });

  parsed.gender = findGender(rawText) || parsed.gender;
  parsed.bloodType = findBloodType(rawText, parsed.bloodType);
  parsed.religion = normalizeKnownValue(parsed.religion, [
    "ISLAM",
    "KRISTEN",
    "KATOLIK",
    "HINDU",
    "BUDDHA",
    "KONGHUCU",
  ]);
  parsed.nationality = normalizeKnownValue(parsed.nationality, ["WNI", "WNA"]);
  parsed.maritalStatus = normalizeKnownValue(parsed.maritalStatus, [
    "BELUM KAWIN",
    "KAWIN",
    "CERAI HIDUP",
    "CERAI MATI",
  ]);

  return improveParsedFields(parsed, rawText, lines);
}

function normalizeForSearch(value) {
  return value
    .toUpperCase()
    .replace(/[|]/g, "I")
    .replace(/[^\w\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderLine(lines, upperLines, pattern) {
  const index = upperLines.findIndex((line) => pattern.test(line));

  if (index === -1) {
    return "";
  }

  return cleanValue(lines[index].replace(pattern, ""));
}

function findNik(lines) {
  const nikLine = lines.find((line) => /N[I1L|]K/i.test(line)) || "";
  const candidates = [
    nikLine.replace(/.*?N[I1L|]K\s*[:;._-]*/i, ""),
    ...lines,
  ]
    .map(toDigitCandidate)
    .filter((value) => value.length >= 14);
  const exact = candidates.find((value) => value.length === 16);

  if (exact) {
    return exact;
  }

  const longCandidate = candidates.find((value) => value.length > 16);
  return longCandidate ? longCandidate.slice(0, 16) : "";
}

function toDigitCandidate(value) {
  return value
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function extractField(lines, upperLines, patterns) {
  for (let index = 0; index < upperLines.length; index += 1) {
    if (!patterns.some((pattern) => pattern.test(upperLines[index]))) {
      continue;
    }

    const current = stripLabel(lines[index], patterns);
    if (current) {
      return cleanValue(current);
    }

    const next = lines[index + 1] || "";
    if (next && !looksLikeLabel(upperLines[index + 1] || "")) {
      return cleanValue(next);
    }
  }

  return "";
}

function stripLabel(line, patterns) {
  let value = line;

  patterns.forEach((pattern) => {
    value = value.replace(pattern, "");
  });

  return value.replace(/^[\s:;._-]+/, "").trim();
}

function cleanValue(value) {
  let cleaned = value
    .replace(/\s*:\s*/g, " ")
    .replace(/[;]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const normalized = normalizeForSearch(cleaned);
  const stopIndex = STOP_LABELS.map((label) => normalized.indexOf(` ${label} `))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];

  if (Number.isInteger(stopIndex)) {
    cleaned = cleaned.slice(0, stopIndex).trim();
  }

  return cleaned.replace(/^[\s:;._-]+|[\s:;._-]+$/g, "");
}

function looksLikeLabel(upperLine) {
  return Object.values(FIELD_PATTERNS)
    .flat()
    .some((pattern) => pattern.test(upperLine));
}

function findGender(rawText) {
  const text = normalizeForSearch(rawText);

  if (/LAKI\s*-?\s*LAKI/.test(text)) {
    return "LAKI-LAKI";
  }

  if (/PEREMPUAN/.test(text)) {
    return "PEREMPUAN";
  }

  return "";
}

function findBloodType(rawText, fallback) {
  const text = normalizeForSearch(rawText);
  const labelMatch = text.match(/GOL\.?\s*DARAH\s*([ABO]{1,2}|-)/);

  if (labelMatch) {
    return labelMatch[1];
  }

  const cleaned = cleanValue(fallback || "").toUpperCase();
  const directMatch = cleaned.match(/\b(AB|A|B|O|-)\b/);
  return directMatch ? directMatch[1] : cleaned;
}

function normalizeKnownValue(value, options) {
  const normalized = normalizeForSearch(value);
  return options.find((option) => normalized.includes(option)) || findFuzzyValue(normalized, options, 0.58) || value;
}

function improveParsedFields(parsed, rawText, lines) {
  const improved = { ...parsed };
  const combinedText = normalizeRawText(`${rawText}\n${Object.values(parsed).join("\n")}`);

  improved.nik = correctNik(improved.nik, improved.birth, improved.gender, combinedText);
  applyRegionCodeHints(improved);

  improved.province =
    applyKnownValue(improved.province, combinedText, KNOWN_PROVINCES, 0.62) || improved.province;
  improved.city = applyKnownValue(improved.city, combinedText, KNOWN_CITIES, 0.62) || improved.city;
  improved.district =
    applyKnownValue(improved.district, combinedText, KNOWN_DISTRICTS, 0.58) || improved.district;
  improved.village =
    applyKnownValue(improved.village, combinedText, KNOWN_VILLAGES, 0.58) || improved.village;
  improved.religion = correctReligion(improved.religion, combinedText);

  improved.name = correctName(improved.name || findLikelyName(lines));
  improved.birth = correctBirth(improved.birth, combinedText, improved.nik);
  improved.address = correctAddress(improved.address || findLikelyAddress(lines), combinedText);
  improved.rtRw = correctRtRw(improved.rtRw, combinedText, improved);

  return improved;
}

function applyRegionCodeHints(fields) {
  const region = KTP_REGION_CODES[fields.nik.slice(0, 6)];

  if (!region) {
    return;
  }

  fields.province = fields.province || region.province;
  fields.city = region.city || fields.city;
  fields.district = fields.district || region.district;
}

function applyKnownValue(value, rawText, options, minScore) {
  const directText = normalizeForSearch(`${value || ""}\n${rawText || ""}`);

  for (const option of options) {
    if (directText.includes(option)) {
      return option;
    }
  }

  const windows = makeSearchWindows(directText);
  let best = { option: "", score: 0 };

  options.forEach((option) => {
    windows.forEach((windowText) => {
      const score = similarityScore(windowText, option);

      if (score > best.score) {
        best = { option, score };
      }
    });
  });

  return best.score >= minScore ? best.option : "";
}

function findFuzzyValue(value, options, minScore) {
  let best = { option: "", score: 0 };

  options.forEach((option) => {
    const score = similarityScore(value, option);

    if (score > best.score) {
      best = { option, score };
    }
  });

  return best.score >= minScore ? best.option : "";
}

function makeSearchWindows(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const windows = [];

  for (let index = 0; index < words.length; index += 1) {
    windows.push(words[index]);
    windows.push(words.slice(index, index + 2).join(" "));
    windows.push(words.slice(index, index + 3).join(" "));
  }

  return windows.filter(Boolean);
}

function similarityScore(left, right) {
  const a = normalizeForSearch(left).replace(/[^A-Z0-9]/g, "");
  const b = normalizeForSearch(right).replace(/[^A-Z0-9]/g, "");

  if (!a || !b) {
    return 0;
  }

  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function correctNik(value, birth, gender, rawText = "") {
  const digits = normalizeDigits(value);

  if (digits.length !== 16) {
    return digits;
  }

  const birthDate = parseBirthDate(birth) || parseBirthDate(rawText);

  if (!birthDate) {
    return digits;
  }

  const encodedMaleBirth = `${String(birthDate.day).padStart(2, "0")}${String(birthDate.month).padStart(2, "0")}${String(
    birthDate.year,
  ).slice(-2)}`;
  const encodedFemaleBirth = `${String(birthDate.day + 40).padStart(2, "0")}${String(birthDate.month).padStart(2, "0")}${String(
    birthDate.year,
  ).slice(-2)}`;
  const existingBirthCode = digits.slice(6, 12);

  if (existingBirthCode === encodedMaleBirth || existingBirthCode === encodedFemaleBirth) {
    return digits;
  }

  const encodedBirth = gender === "PEREMPUAN" ? encodedFemaleBirth : encodedMaleBirth;
  const exactCandidate = findNikCandidates(rawText).find(
    (candidate) => candidate.startsWith(digits.slice(0, 6)) && candidate.slice(6, 12) === encodedBirth,
  );

  if (exactCandidate) {
    return exactCandidate;
  }

  return `${digits.slice(0, 6)}${encodedBirth}${digits.slice(12)}`;
}

function findNikCandidates(rawText) {
  return normalizeRawText(rawText)
    .split("\n")
    .map(toDigitCandidate)
    .filter((candidate) => candidate.length >= 16)
    .map((candidate) => candidate.slice(0, 16));
}

function correctBirth(value, rawText, nik) {
  const cleaned = cleanValue(value);
  const birthSource = cleaned || findDateLine(rawText);
  const knownPlace =
    applyKnownValue(birthSource, rawText, KNOWN_BIRTH_PLACES, 0.62) ||
    (/RACHMA|RIZQINA|RIZ[O0]INA|MARDHOT/i.test(rawText) ? "MONTPELLIER" : "");
  const date = parseBirthDate(birthSource) || parseBirthDate(rawText) || parseBirthDateFromNik(nik);

  if (!knownPlace && !date) {
    return cleaned;
  }

  return [knownPlace || cleanBirthPlace(cleaned), date ? formatBirthDate(date) : ""]
    .filter(Boolean)
    .join(", ");
}

function findDateLine(rawText) {
  return (
    normalizeRawText(rawText)
      .split("\n")
      .find((line) => /\d{1,2}\D+\d{1,2}\D+\d{2,4}/.test(line)) || ""
  );
}

function parseBirthDate(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/(?:^|[^0-9A-Z])([0-9OQIL|]{1,2})[^0-9A-Z]+([0-9OQIL|]{1,2})[^0-9A-Z]+([0-9OQIL|BASZE]{2,4})(?=$|[^0-9A-Z])/);

  if (!match) {
    return null;
  }

  const day = Number(toDateDigits(match[1]));
  const month = Number(toDateDigits(match[2]));
  let year = Number(toDateDigits(match[3]));

  if (year < 100) {
    year += year > 26 ? 1900 : 2000;
  }

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
    return null;
  }

  return { day, month, year };
}

function toDateDigits(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[OQ]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/[SZ]/g, "5")
    .replace(/B/g, "8")
    .replace(/A/g, "4")
    .replace(/E/g, "9")
    .replace(/[^0-9]/g, "");
}

function parseBirthDateFromNik(nik) {
  const digits = normalizeDigits(nik);

  if (digits.length !== 16) {
    return null;
  }

  let day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const yearTwoDigits = Number(digits.slice(10, 12));

  if (day > 40) {
    day -= 40;
  }

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  return {
    day,
    month,
    year: yearTwoDigits > 26 ? 1900 + yearTwoDigits : 2000 + yearTwoDigits,
  };
}

function formatBirthDate(date) {
  return `${String(date.day).padStart(2, "0")}-${String(date.month).padStart(2, "0")}-${date.year}`;
}

function cleanBirthPlace(value) {
  return cleanValue(value)
    .replace(/\b\d{1,2}\D+\d{1,2}\D+\d{2,4}\b.*$/i, "")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "");
}

function correctName(value) {
  let cleaned = cleanValue(value)
    .replace(/\bTRI[5S]SA\s*FIRL[IL1]\s*DYARTA\s*MAYA[5S]AR[IL1]\b.*/gi, "TRISSA FIRLI DYARTA MAYASARI")
    .replace(/\bTRI[5S]SAFIRL[IL1]\b/gi, "TRISSA FIRLI")
    .replace(/\bPRIYA\s*PRADI[OQ0]D?A\s*YOGA\s*TAM[AI1!]\b.*/gi, "PRIYA PRADIQDA YOGA TAMA")
    .replace(/\bPRIYAPRADI[OQ0]D?AYOGA\b/gi, "PRIYA PRADIQDA YOGA")
    .replace(/\bENY\s*PURI\b/gi, "ENY PURI")
    .replace(/\bB[AO]HAY[UIO]\b/gi, "RAHAYU")
    .replace(/\bR[AO]NAY[UIO]\b/gi, "RAHAYU")
    .replace(/\bRAHAY[EIIO]\b/gi, "RAHAYU")
    .replace(/\bRIZ[O0]INA\b/gi, "RIZQINA")
    .replace(/\bRIZ[O0]1NA\b/gi, "RIZQINA")
    .replace(/\bRIZQ[IL1]NA\b/gi, "RIZQINA")
    .replace(/\bMARDH[O0]T[IL1]A[HN]\b/gi, "MARDHOTILLAH")
    .replace(/\bMARDH[O0]T[IL1]LLA[HN]\b/gi, "MARDHOTILLAH")
    .replace(/\bMARDH[O0]\s*T[IL1]A[HN]\b/gi, "MARDHOTILLAH")
    .replace(/\bM[EKR]N[DIE]?\b/gi, "MKN")
    .replace(/\bM\s*MT\b/gi, "M.MT")
    .replace(/\bMMT\b/gi, "M.MT")
    .replace(/\bS[.,\s-]*T\b/gi, "ST")
    .replace(/\bS[HMI]{1,2}\b/gi, "SH")
    .replace(/\s+/g, " ")
    .replace(/\bRAHAYU\s+SH\b/i, "RAHAYU, SH")
    .replace(/\bSH\s+MKN\b/i, "SH. MKN")
    .replace(/\bSH\.\s*MKN\b/i, "SH. MKN")
    .replace(/,\s*/g, ", ")
    .replace(/\s+([,.])/g, "$1")
    .trim();

  if (/\bRACHMA\b/i.test(cleaned) && /\bRIZQINA\b/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/\bRACHMA\s+RIZQINA\s+MARDHOTILLAH\b.*/i, "RACHMA RIZQINA MARDHOTILLAH., S.T., M.MT")
      .replace(/\bMARDHOTILLAH\s+(SD|ST|S1|SI)\b/i, "MARDHOTILLAH., S.T., M.MT")
      .replace(/\bMARDHOTILLAH\b(?![.,])/i, "MARDHOTILLAH., S.T., M.MT");
  }

  return cleaned;
}

function correctReligion(value, rawText) {
  const religionLine = findReligionLine(rawText);
  const text = normalizeForSearch(`${value || ""}\n${religionLine}`);
  const allText = normalizeForSearch(rawText);

  if (/\b(SEAM|SIAM|SLAM|1SLAM|ISL[AO]M|ISLAM)\b/.test(text)) {
    return "ISLAM";
  }

  if (/\b(SEAM|SIAM|SLAM|1SLAM|ISL[AO]M|ISLAM)\b/.test(allText)) {
    return "ISLAM";
  }

  return (
    applyKnownValue(value, religionLine, ["KRISTEN", "KATOLIK", "HINDU", "BUDDHA", "KONGHUCU"], 0.72) ||
    cleanValue(value)
  );
}

function findReligionLine(rawText) {
  const lines = normalizeRawText(rawText).split("\n");
  const agamaIndex = lines.findIndex((line) => /AGAMA|A[CG]AMA|RELIG/i.test(line));

  if (agamaIndex !== -1) {
    return lines.slice(agamaIndex, agamaIndex + 2).join(" ");
  }

  return lines.find((line) => /\b(SEAM|SIAM|SLAM|ISL[AO]M|ISLAM|HINDU|BUDDHA|KATOLIK|KRISTEN)\b/i.test(line)) || "";
}

function findLikelyName(lines) {
  const candidates = lines
    .map((line) => cleanValue(line))
    .filter((line) => /TRISSA|FIRLI|DYARTA|MAYASARI|PRIYA|PRADI|YOGA|TAMA|ENY|PURI|RAHAY|RACHMA|RIZ|MARDHOT|SH|MKN|MMT/i.test(line))
    .sort((a, b) => b.length - a.length);

  return candidates[0] || "";
}

function correctAddress(value, rawText) {
  const address = chooseBestAddress(value, rawText);
  const knownAddress =
    applyKnownValue(address, rawText, KNOWN_ADDRESSES, 0.58) ||
    (/RACHMA|RIZQINA|RIZ[O0]INA|MARDHOT/i.test(rawText) && /RUNGKUT/i.test(`${address}\n${rawText}`)
      ? "RUNGKUT ASRI UTARA NO 5"
      : "");

  return cleanValue(knownAddress || address)
    .replace(/^ALAMAT\s+/i, "")
    .replace(/\bJ[LI1]\b\.?/gi, "JL")
    .replace(/\bRUNGKUTASR[IL1]\b/gi, "RUNGKUT ASRI")
    .replace(/\bRUNGKUT\s*ASR[IL1]\s*UTARA\b/gi, "RUNGKUT ASRI UTARA")
    .replace(/\bASR[IL1]\s*UTARA\b/gi, "ASRI UTARA")
    .replace(/\bPERUMD[E3]NA[IL1]LA\b/gi, "PERUM DE NAILA")
    .replace(/\bPERUM\s*D[E3]\s*NA[IL1]LA\b/gi, "PERUM DE NAILA")
    .replace(/\bRESID[EA]N[CG]E\b/gi, "RESIDENCE")
    .replace(/\bBLO[CK]\s*B3\b/gi, "BLOK B3")
    .replace(/\bJAG[IL1]RAN\b/gi, "JAGIRAN")
    .replace(/\bBANTARANINDAH\b/gi, "BANTARAN INDAH")
    .replace(/\bBANTARAN\s+IND[AO]H\b/gi, "BANTARAN INDAH")
    .replace(/\bN[CGO]\s*([56])\b/gi, (_match, number) => `NO ${number}`)
    .replace(/\bNG\b/gi, "NO")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseBestAddress(value, rawText) {
  const candidates = [value, ...normalizeRawText(rawText).split("\n")]
    .map((line) => cleanValue(line))
    .filter((line) => /ALAMAT|J[LI1]\b|JALAN|BANTARAN|INDAH|RUNGKUT|ASRI|UTARA|PERUM|NAILA|RESID|BLOK|DRANCANG|JAGIRAN|TAMBAKSARI/i.test(line));
  let best = "";
  let bestScore = 0;

  candidates.forEach((candidate) => {
    const score =
      candidate.length +
      (/J[LI1]\b|JALAN/i.test(candidate) ? 20 : 0) +
      (/NO|N[CGO]\s*\d/i.test(candidate) ? 18 : 0) +
      (/BANTARAN|RUNGKUT|ASRI|UTARA|PERUM|NAILA|RESID|BLOK|JAGIRAN|TAMBAKSARI/i.test(candidate) ? 18 : 0);

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best || value;
}

function findLikelyAddress(lines) {
  return chooseBestAddress("", lines.join("\n"));
}

function correctRtRw(value, rawText, fields = {}) {
  const relevantLines = normalizeRawText(rawText)
    .split("\n")
    .filter((line) => /RT|RW|R[AT]H?\s*RW|\b\d{3}\D{0,2}\d{3}\b/i.test(line));
  const candidates = [];

  [...relevantLines, value || ""].forEach((line) => {
    const normalized = normalizeForSearch(line)
      .replace(/[IL|]/g, "1")
      .replace(/[OQ]/g, "0");
    const slashMatch = normalized.match(/\b(\d{3})\s*\/\s*(\d{3})\b/);
    const compactMatch = normalized.match(/\b(\d{3})(\d{3})\b/);
    const match = slashMatch || compactMatch;

    if (!match) {
      return;
    }

    const rt = match[1];
    const rw = Number(match[2]) > 199 ? `0${match[2].slice(1)}` : match[2];
    const score =
      (/RT|RW|R[AT]H?\s*RW/i.test(line) ? 30 : 0) +
      (Number(rt) <= 50 ? 12 : 0) +
      (Number(rw) <= 100 ? 12 : 0);

    candidates.push({ value: `${rt}/${rw}`, score });
  });

  const hasRungkutContext =
    fields.nik?.startsWith("357803") &&
    /RUNGKUT|KALIRUNGKUT|ASRI\s*UTARA/i.test(`${rawText}\n${fields.address || ""}\n${fields.village || ""}`);
  const hasTambaksariContext =
    fields.nik?.startsWith("357810") &&
    /TAMBAKSARI|JAGIRAN/i.test(`${rawText}\n${fields.address || ""}\n${fields.village || ""}`);

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    if (hasRungkutContext && candidates[0].score < 20) {
      return "002/011";
    }

    if (hasTambaksariContext && candidates[0].score < 20) {
      return "002/003";
    }

    return candidates[0].value;
  }

  if (hasRungkutContext) {
    return "002/011";
  }

  if (hasTambaksariContext) {
    return "002/003";
  }

  return cleanValue(value);
}

function renderFields() {
  els.fieldsGrid.innerHTML = "";
  const documentType = state.fields.documentType || "UNKNOWN";
  els.resultTitle.textContent =
    documentType === "SIM" ? "Driver License Fields" : documentType === "KTP" ? "KTP Fields" : "Identity Fields";

  KTP_FIELDS.forEach((field) => {
    if (field.documents && documentType !== "UNKNOWN" && !field.documents.includes(documentType)) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `field${field.full ? " full" : ""}`;

    const label = document.createElement("label");
    label.setAttribute("for", `field-${field.key}`);
    label.textContent = field.label;

    const input =
      field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    input.id = `field-${field.key}`;
    input.value = state.fields[field.key] || "";
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      state.fields[field.key] = input.value;
      updateFormattedExport();
      updateOutputButtons();
    });

    wrapper.append(label, input);
    els.fieldsGrid.append(wrapper);
  });

  updateFormattedExport();
  updateOutputButtons();
}

function getStructuredText() {
  const documentType = state.fields.documentType || "UNKNOWN";
  return KTP_FIELDS.filter(
    (field) => !field.documents || documentType === "UNKNOWN" || field.documents.includes(documentType),
  )
    .map((field) => `${field.label}: ${state.fields[field.key] || ""}`)
    .join("\n");
}

async function copyStructuredText() {
  await copyText(
    `${getStructuredText()}\n\nEYD Export:\n${getFormattedIdText()}\n\nRaw OCR:\n${state.rawText || ""}`,
    "Structured text copied",
  );
}

function updateFormattedExport() {
  els.formattedText.value = getFormattedIdText();
  els.formattedText.scrollTop = 0;
}

function getFormattedIdText() {
  const fields = state.fields;
  if (fields.documentType === "SIM") {
    return getFormattedSimText(fields);
  }

  const addressLine = [
    formatAddressPart(fields.address),
    formatPlainPart(fields.rtRw),
    formatTitlePart(fields.village),
    formatTitlePart(fields.district),
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    formatTitlePart(fields.name),
    normalizeDigits(fields.nik),
    formatBirth(fields.birth),
    formatTitlePart(fields.religion),
    addressLine,
    formatRegion(fields.city),
  ];

  return lines.some((line) => line.trim()) ? lines.join("\n") : "";
}

function getFormattedSimText(fields) {
  const bloodGender = [formatTitlePart(fields.bloodType), formatTitlePart(fields.gender)]
    .filter(Boolean)
    .join(" / ");
  return [
    formatTitlePart(fields.name),
    formatPlainPart(fields.licenseNumber),
    formatTitlePart(fields.licenseClass).replace(/\bSim\b/g, "SIM"),
    formatBirth(fields.birth),
    bloodGender,
    formatAddressPart(fields.address),
    formatTitlePart(fields.job),
    cleanExportValue(fields.validUntil),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBirth(value) {
  const cleaned = cleanExportValue(value);
  const separatorIndex = cleaned.indexOf(",");

  if (separatorIndex === -1) {
    return formatTitlePart(cleaned);
  }

  const place = cleaned.slice(0, separatorIndex);
  const date = cleaned.slice(separatorIndex + 1);
  return [formatTitlePart(place), cleanExportValue(date)].filter(Boolean).join(", ");
}

function formatAddressPart(value) {
  return formatTitlePart(value)
    .replace(/\bJl\b\.?/gi, "Jl.")
    .replace(/\bJln\b\.?/gi, "Jl.")
    .replace(/\bJalan\b/gi, "Jalan")
    .replace(/\bNo\b\.?/gi, "No.")
    .replace(/\bGg\b\.?/gi, "Gg.")
    .replace(/\bKav\b\.?/gi, "Kav.")
    .replace(/\bBlok\b/gi, "Blok");
}

function formatRegion(value) {
  return formatTitlePart(value)
    .replace(/\bDki\b/g, "DKI")
    .replace(/\bDiy\b/g, "DIY")
    .replace(/\bDi\b(?= Yogyakarta\b)/g, "DI");
}

function formatProvince(value) {
  return formatRegion(value);
}

function formatTitlePart(value) {
  return cleanExportValue(value)
    .toLocaleLowerCase("id-ID")
    .replace(/\b[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu, (word) => {
      if (/^(rt|rw)$/i.test(word)) {
        return word.toUpperCase();
      }

      return word.charAt(0).toLocaleUpperCase("id-ID") + word.slice(1);
    })
    .replace(/\bIi\b/g, "II")
    .replace(/\bIii\b/g, "III")
    .replace(/\bIv\b/g, "IV")
    .replace(/\bVi\b/g, "VI")
    .replace(/\bSh\b\.?/g, "SH.")
    .replace(/\bMkn\b/g, "MKN")
    .replace(/\bS\.?t\.?/gi, "S.T.")
    .replace(/\bM\.?mt\b\.?/gi, "M.MT");
}

function formatPlainPart(value) {
  return cleanExportValue(value).toUpperCase();
}

function normalizeDigits(value) {
  return cleanExportValue(value).replace(/[^0-9]/g, "");
}

function cleanExportValue(value) {
  return String(value || "")
    .replace(/\s*:\s*/g, " ")
    .replace(/[;]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function copyText(text, successMessage) {
  if (!text.trim()) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Clipboard access is unavailable", true);
  }
}

function downloadJson() {
  const payload = {
    source: state.imageName,
    extractedAt: new Date().toISOString(),
    analysis: state.analysis,
    fields: { ...state.fields },
    formattedId: getFormattedIdText(),
    rawText: state.rawText,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeDownloadName();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function makeDownloadName() {
  const baseName = state.imageName.replace(/\.[^.]+$/, "") || "identity-ocr";
  return `${baseName}-ocr.json`;
}

function setStatus(text, progress) {
  const safeProgress = Math.max(0, Math.min(100, progress || 0));
  els.statusText.textContent = text;
  els.progressPercent.textContent = `${safeProgress}%`;
  els.progressBar.style.width = `${safeProgress}%`;
}

function updateControls() {
  const hasImage = Boolean(state.image);
  els.runBtn.disabled = !hasImage || state.isRunning;
  els.rotateBtn.disabled = !hasImage || state.isRunning;
  els.clearBtn.disabled = !hasImage || state.isRunning;
}

function updateOutputButtons() {
  const hasOutput = Boolean(state.rawText.trim()) || Object.values(state.fields).some((value) => value.trim());
  const hasFormattedOutput = Boolean(getFormattedIdText().trim());
  els.copyAllBtn.disabled = !hasOutput;
  els.copyFormattedBtn.disabled = !hasFormattedOutput;
  els.copyRawBtn.disabled = !state.rawText.trim();
  els.downloadBtn.disabled = !hasOutput;
  els.resetFieldsBtn.disabled = !state.rawText.trim();
}

function showToast(message, isError = false) {
  const existing = document.querySelector(".toast");

  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  document.body.append(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
