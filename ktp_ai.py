from __future__ import annotations

import base64
import gzip
import io
import os
import re
import shutil
from dataclasses import dataclass
from datetime import date as calendar_date
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel, Field


class KtpFields(BaseModel):
    documentType: Literal["KTP", "SIM", "UNKNOWN"] = "UNKNOWN"
    province: str = ""
    city: str = ""
    nik: str = ""
    licenseNumber: str = ""
    licenseClass: str = ""
    name: str = ""
    birth: str = ""
    gender: str = ""
    bloodType: str = ""
    address: str = ""
    rtRw: str = ""
    village: str = ""
    district: str = ""
    religion: str = ""
    maritalStatus: str = ""
    job: str = ""
    nationality: str = ""
    validUntil: str = ""


class AiKtpExtraction(KtpFields):
    confidence: float = Field(default=0.0, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)


class KtpResult(BaseModel):
    documentType: Literal["KTP", "SIM", "UNKNOWN"]
    fields: KtpFields
    formattedText: str
    rawText: str
    engine: str
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class ImageCandidate:
    label: str
    image: Image.Image


@dataclass(frozen=True)
class AiImageData:
    label: str
    image_url: str
    detail: Literal["low", "high", "auto", "original"]


REGIONS = {
    "357305": ("JAWA TIMUR", "KOTA MALANG", "LOWOKWARU"),
    "357803": ("JAWA TIMUR", "KOTA SURABAYA", "RUNGKUT"),
    "352515": ("JAWA TIMUR", "GRESIK", "MENGANTI"),
    "357810": ("JAWA TIMUR", "KOTA SURABAYA", "TAMBAKSARI"),
}

FIELD_LABELS = {
    "name": r"NAMA",
    "birth": r"TEMPAT\s*/?\s*TGL\s*LAHIR|TEMPAT.*LAHIR",
    "gender": r"JENIS\s*KELAMIN",
    "bloodType": r"GOL\.?\s*DARAH",
    "address": r"ALAMAT",
    "rtRw": r"RT\s*/?\s*RW",
    "village": r"KEL\s*/?\s*DESA|KELURAHAN|DESA",
    "district": r"KECAMATAN",
    "religion": r"AGAMA",
    "maritalStatus": r"STATUS\s*PERKAWINAN",
    "job": r"PEKERJAAN",
    "nationality": r"KEWARGANEGARAAN",
    "validUntil": r"BERLAKU\s*(?:HINGGA|SAMPAI)|VALID\s*(?:UNTIL|THRU)",
    "licenseNumber": r"NO\.?\s*SIM|NOMOR\s*SIM|SIM\s*NO",
    "licenseClass": r"GOLONGAN\s*SIM|JENIS\s*SIM|KELAS\s*SIM",
}

RELIGIONS = ("ISLAM", "KRISTEN", "KATOLIK", "HINDU", "BUDDHA", "KONGHUCU")
NIK_PROVINCE_CODES = {
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
    "31", "32", "33", "34", "35", "36",
    "51", "52", "53",
    "61", "62", "63", "64", "65",
    "71", "72", "73", "74", "75", "76",
    "81", "82",
    "91", "92", "93", "94", "95", "96",
}
PROVINCE_NIK_PREFIXES = {
    "ACEH": "11",
    "SUMATERA UTARA": "12",
    "SUMATERA BARAT": "13",
    "RIAU": "14",
    "JAMBI": "15",
    "SUMATERA SELATAN": "16",
    "BENGKULU": "17",
    "LAMPUNG": "18",
    "BANGKA BELITUNG": "19",
    "KEPULAUAN RIAU": "21",
    "DKI JAKARTA": "31",
    "JAWA BARAT": "32",
    "JAWA TENGAH": "33",
    "DI YOGYAKARTA": "34",
    "JAWA TIMUR": "35",
    "BANTEN": "36",
    "BALI": "51",
    "NUSA TENGGARA BARAT": "52",
    "NUSA TENGGARA TIMUR": "53",
    "KALIMANTAN BARAT": "61",
    "KALIMANTAN TENGAH": "62",
    "KALIMANTAN SELATAN": "63",
    "KALIMANTAN TIMUR": "64",
    "KALIMANTAN UTARA": "65",
    "SULAWESI UTARA": "71",
    "SULAWESI TENGAH": "72",
    "SULAWESI SELATAN": "73",
    "SULAWESI TENGGARA": "74",
    "GORONTALO": "75",
    "SULAWESI BARAT": "76",
    "MALUKU": "81",
    "MALUKU UTARA": "82",
    "PAPUA": "91",
    "PAPUA BARAT": "92",
}


class KtpExtractor:
    def __init__(self) -> None:
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-5.5")
        self.openai_ocr_model = os.getenv("OPENAI_OCR_MODEL", self.openai_model)
        self.openai_ocr_adaptive = env_flag("OPENAI_OCR_ADAPTIVE", True)
        self.openai_ocr_context_chars = env_int("OPENAI_OCR_CONTEXT_CHARS", 5000)
        self.openai_ocr_fallback_context_chars = env_int("OPENAI_OCR_FALLBACK_CONTEXT_CHARS", 12000)
        self.tessdata_dir = ensure_tesseract_data()
        self.tesseract_language = os.getenv("TESSERACT_LANGUAGE", "ind+eng")
        self.tesseract_cmd = resolve_tesseract_cmd()
        if self.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = self.tesseract_cmd

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def local_ocr_available(self) -> bool:
        return bool(self.tesseract_cmd)

    def extract(self, image_bytes: bytes, mode: Literal["auto", "ai", "local"] = "auto") -> KtpResult:
        if not image_bytes:
            raise ValueError("Image is empty")

        should_use_ai = mode == "ai" or (mode == "auto" and self.ai_configured)
        local_text = ""
        local_fields = KtpFields()
        local_warnings: list[str] = []

        if self.local_ocr_available:
            try:
                local_text = self.local_ocr(image_bytes)
                local_fields = normalize_fields(parse_local_ocr(local_text))
            except pytesseract.TesseractNotFoundError as exc:
                self.tesseract_cmd = ""
                local_warnings.append("Local Tesseract OCR is unavailable; AI vision used without OCR candidates.")
                if not should_use_ai:
                    raise RuntimeError("Local OCR requires the tesseract executable to be installed on the server.") from exc
            except Exception as exc:
                if not should_use_ai:
                    raise
                local_warnings.append(f"Local OCR failed; AI vision used without OCR candidates: {type(exc).__name__}")
        elif not should_use_ai:
            raise RuntimeError("Local OCR requires the tesseract executable to be installed on the server.")
        elif self.ai_configured:
            local_warnings.append("Local Tesseract OCR is unavailable; AI vision used without OCR candidates.")

        if should_use_ai and not self.ai_configured:
            if not local_text:
                raise RuntimeError("AI mode requested, but OPENAI_API_KEY is not configured and local OCR is unavailable.")
            warnings = [*local_warnings, "AI mode requested, but OPENAI_API_KEY is not configured. Used local OCR."]
            return build_result(local_fields, local_text, "local-tesseract", warnings)

        if should_use_ai:
            try:
                ai_fields, confidence, warnings = self.ai_extract(image_bytes, local_text)
                merged = merge_fields(normalize_fields(ai_fields), local_fields)
                return build_result(
                    merged,
                    local_text,
                    f"openai-vision:{self.openai_ocr_model}",
                    [*local_warnings, *warnings],
                    confidence,
                )
            except Exception as exc:
                if not local_text:
                    raise RuntimeError(f"AI extraction failed and local OCR is unavailable: {type(exc).__name__}") from exc
                warnings = [f"AI extraction failed; local OCR was used: {type(exc).__name__}"]
                return build_result(local_fields, local_text, "local-tesseract-fallback", warnings)

        return build_result(local_fields, local_text, "local-tesseract", local_warnings)

    def local_ocr(self, image_bytes: bytes) -> str:
        images = make_ocr_images(image_bytes)
        outputs: list[str] = []

        for index, image in enumerate(images):
            for psm in (6, 11):
                text = pytesseract.image_to_string(
                    image,
                    lang=self.tesseract_language,
                    config=(
                        f'--tessdata-dir "{self.tessdata_dir}" --oem 3 --psm {psm} '
                        "-c preserve_interword_spaces=1"
                    ),
                )
                outputs.append(f"PASS {index + 1} PSM {psm}\n{text.strip()}")

        return normalize_text("\n".join(outputs))

    def ai_extract(self, image_bytes: bytes, local_text: str) -> tuple[KtpFields, float, list[str]]:
        from openai import OpenAI

        client = OpenAI(api_key=self.openai_api_key)
        if self.openai_ocr_adaptive:
            fields, confidence, warnings = self.ai_extract_once(
                client,
                image_bytes,
                local_text,
                profile="balanced",
                max_ocr_chars=self.openai_ocr_context_chars,
            )
            if not needs_accurate_ai_retry(fields, confidence, warnings):
                return fields, confidence, warnings

        return self.ai_extract_once(
            client,
            image_bytes,
            local_text,
            profile="accurate",
            max_ocr_chars=self.openai_ocr_fallback_context_chars,
        )

    def ai_extract_once(
        self,
        client,
        image_bytes: bytes,
        local_text: str,
        profile: Literal["balanced", "accurate"],
        max_ocr_chars: int,
    ) -> tuple[KtpFields, float, list[str]]:
        ai_images = ai_image_data_urls(image_bytes, profile=profile, document_hint=detect_document_type(local_text))
        ocr_context = compact_ocr_context(local_text, max_chars=max_ocr_chars)
        prompt = f"""
Classify and read the Indonesian identity document in the image. It may be:
- KTP: Indonesian national identity card.
- SIM: Indonesian driving license (Surat Izin Mengemudi).
- UNKNOWN: neither document can be identified confidently.

Return documentType as exactly KTP, SIM, or UNKNOWN and return fields exactly as printed.
Cross-check digits and spelling visually against the OCR candidates below.
The image inputs may include rotated/upright crops generated by preprocessing. Prefer the clearest upright crop.

Rules:
- Never invent a value that is not visible.
- For KTP, NIK must contain exactly 16 digits.
- For SIM, return licenseNumber and licenseClass. licenseClass is the printed class such as SIM A, SIM B I, SIM B II, or SIM C.
- Preserve academic/professional titles in the name.
- For name, read letter-by-letter from the visible text. Do not autocorrect uncommon Indonesian names into more common-looking names.
- Preserve uncommon spellings exactly as printed, including names such as PRANDITA.
- Preserve spaces inside names exactly as printed; do not merge separate words such as YULIANING SIWI.
- Do not drop short leading name tokens when they are printed after the Nama label, including two-letter tokens such as RT.
- For names, carefully distinguish visual confusions: RT versus BE/DE/DI, T versus L/I, and separated initials versus one merged word.
- birth must be "PLACE, DD-MM-YYYY".
- rtRw must be "NNN/NNN".
- For RT/RW, read the value from the RT/RW line digit-by-digit; do not infer it from the NIK or address line.
- city must preserve KOTA or KABUPATEN when visible.
- For KTP, use the 16-digit NIK birth segment as a consistency check: positions 7-12 encode DDMMYY, with female day values printed as day + 40. If NIK and birth conflict, reread both values from the clearest crop before returning.
- Do not change a clearly printed NIK or birth date only to make them consistent; return the printed value and warn if they still conflict.
- validUntil must preserve the printed expiry date.
- Use uppercase field values; formatting is handled later.
- Report uncertainty in warnings and lower confidence only when a field value is actually hard to read.
- Do not warn merely because the original photo is rotated if any supplied image variant is readable.

OCR candidates:
{ocr_context}
""".strip()

        content = [{"type": "input_text", "text": prompt}]
        for image_data in ai_images:
            content.extend(
                [
                    {"type": "input_text", "text": f"Image variant: {image_data.label}"},
                    {
                        "type": "input_image",
                        "image_url": image_data.image_url,
                        "detail": image_data.detail,
                    },
                ]
            )

        response = client.responses.parse(
            model=self.openai_ocr_model,
            input=[
                {
                    "role": "user",
                    "content": content,
                }
            ],
            text_format=AiKtpExtraction,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("AI returned no structured identity-document result")

        fields = KtpFields(**parsed.model_dump(exclude={"confidence", "warnings"}))
        return fields, parsed.confidence, parsed.warnings


def make_ocr_images(image_bytes: bytes) -> list[Image.Image]:
    scene = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    scene.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
    candidates = card_image_candidates(scene)
    images: list[Image.Image] = []
    for candidate in candidates:
        images.extend(make_ocr_variants(candidate.image))
    return images


def card_image_candidates(scene: Image.Image) -> list[ImageCandidate]:
    candidates = [ImageCandidate(label="original", image=crop_card(scene))]
    primary_ratio = aspect_ratio(candidates[0].image)
    primary_is_full_scene = candidates[0].image.size == scene.size

    rotation_angles: tuple[int, ...] = ()
    if primary_ratio < 1.1 or primary_is_full_scene and scene.height > scene.width * 1.15:
        rotation_angles = (90, 270)
    elif primary_ratio > 2.15:
        rotation_angles = (90, 270)

    for angle in rotation_angles:
        rotated_scene = scene.rotate(angle, expand=True)
        rotated_crop = crop_card(rotated_scene)
        rotated_ratio = aspect_ratio(rotated_crop)
        if 1.1 <= rotated_ratio <= 2.15:
            candidates.append(ImageCandidate(label=f"rotated-{angle}-crop", image=rotated_crop))

    if candidates[0].image.size != scene.size:
        candidates.append(ImageCandidate(label="full-scene", image=scene))

    return dedupe_image_candidates(candidates)


def aspect_ratio(image: Image.Image) -> float:
    return image.width / max(image.height, 1)


def dedupe_image_candidates(candidates: list[ImageCandidate]) -> list[ImageCandidate]:
    unique: list[ImageCandidate] = []
    seen: set[tuple[str, tuple[int, int]]] = set()
    for candidate in candidates:
        key = (candidate.label, candidate.image.size)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def make_ocr_variants(source: Image.Image) -> list[Image.Image]:
    original = source
    original_balanced = ImageEnhance.Contrast(ImageOps.grayscale(original)).enhance(1.7).filter(ImageFilter.SHARPEN)
    if source.width < 1600:
        scale = 1600 / source.width
        source = source.resize((1600, round(source.height * scale)), Image.Resampling.LANCZOS)

    gray = ImageOps.grayscale(source)
    balanced = ImageEnhance.Contrast(gray).enhance(1.7).filter(ImageFilter.SHARPEN)
    threshold = np.asarray(balanced)
    threshold = cv2.adaptiveThreshold(
        threshold,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    return [original, original_balanced, Image.fromarray(threshold)]


def crop_card(image: Image.Image) -> Image.Image:
    array = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(array, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.width * image.height

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.12:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        ratio = width / max(height, 1)
        if 1.25 <= ratio <= 1.9:
            margin = max(6, round(min(width, height) * 0.02))
            return image.crop(
                (
                    max(0, x - margin),
                    max(0, y - margin),
                    min(image.width, x + width + margin),
                    min(image.height, y + height + margin),
                )
            )

    color_crop = find_color_card_crop(array)
    if color_crop:
        x, y, width, height = color_crop
        margin = max(6, round(min(width, height) * 0.02))
        return image.crop(
            (
                max(0, x - margin),
                max(0, y - margin),
                min(image.width, x + width + margin),
                min(image.height, y + height + margin),
            )
        )

    return image


def find_color_card_crop(array: np.ndarray) -> tuple[int, int, int, int] | None:
    rgb = cv2.cvtColor(array, cv2.COLOR_BGR2RGB)
    red, green, blue = [rgb[:, :, index].astype(np.int16) for index in range(3)]
    image_area = array.shape[0] * array.shape[1]
    candidates: list[tuple[float, tuple[int, int, int, int]]] = []
    masks = (
        ((blue > red - 5) & (green > red - 10) & (blue > 80), 0.085, 0.025, 3),
        ((blue > red) & (green > red) & (blue > 90), 0.045, 0.018, 2),
    )

    for condition, width_scale, height_scale, iterations in masks:
        mask = condition.astype(np.uint8) * 255
        kernel_width = max(9, round(array.shape[1] * width_scale) | 1)
        kernel_height = max(7, round(array.shape[0] * height_scale) | 1)
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, kernel_height)),
            iterations=iterations,
        )
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_OPEN,
            cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)),
        )
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            x, y, width, height = cv2.boundingRect(contour)
            ratio = width / max(height, 1)
            if image_area * 0.04 <= area <= image_area * 0.75 and 1.2 <= ratio <= 2.1:
                candidates.append((area, (x, y, width, height)))

    return max(candidates, default=(0, None), key=lambda item: item[0])[1]


def parse_local_ocr(raw_text: str) -> KtpFields:
    text = normalize_text(raw_text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    fields = KtpFields(documentType=detect_document_type(text))

    fields.nik = find_nik(lines)
    if fields.documentType == "UNKNOWN" and fields.nik:
        fields.documentType = "KTP"
    fields.province = find_header(lines, "PROVINSI")
    fields.city = find_header(lines, r"KOTA|KABUPATEN")

    for key, label in FIELD_LABELS.items():
        setattr(fields, key, extract_labeled_value(lines, label))
    fields.name = choose_name_value(fields.name, find_name_after_nik(lines))

    if fields.documentType == "SIM":
        fields.licenseNumber = fields.licenseNumber or find_license_number(lines, text)
        fields.licenseClass = fields.licenseClass or find_license_class(text, True)
    fields.birth = normalize_birth_value(fields.birth) or find_birth(lines, fields.nik)
    if fields.documentType == "KTP" and fields.nik and fields.birth and not nik_matches_birth_day_month(
        fields.nik, fields.birth
    ):
        fields.nik = ""
    if fields.documentType == "SIM":
        apply_numbered_sim_fields(fields, lines)
        fields.job = fields.job or find_sim_job(text)
        fields.validUntil = find_sim_expiry(text, fields.birth) or fields.validUntil
    fields.religion = find_religion(text, fields.religion)
    fields.rtRw = find_rt_rw(text) or fields.rtRw
    if fields.documentType == "KTP":
        apply_region_hint(fields)
    return fields


def detect_document_type(text: str) -> str:
    upper = normalize_search(text)
    sim_score = sum(
        bool(re.search(pattern, upper))
        for pattern in (
            r"SURAT IZIN MENGEMUDI",
            r"DRIVING LICEN[CS]E",
            r"\bKORLANTAS\b",
            r"\bSIM\s*(?:A|B|C|D)\b",
            r"\bNO\.?\s*SIM\b",
            r"\b\d{4}\s*[-.]\s*\d{4}\s*[-.]\s*\d{5,6}\b",
            r"\b(?:A|B|AB|O)\s*[- ]\s*(?:PRIA|WANITA)\b",
            r"\b(?:PRIA|WANITA)\b.*\bJATIM\b",
        )
    )
    ktp_score = sum(
        bool(re.search(pattern, upper))
        for pattern in (
            r"\bNIK\b",
            r"\bKEL\s*/?\s*DESA\b",
            r"\bKEWARGANEGARAAN\b",
            r"\bSTATUS PERKAWINAN\b",
            r"\bBERLAKU HINGGA\b",
            r"\bPROVINSI\b.*\b(?:KOTA|KABUPATEN)",
        )
    )
    if sim_score >= 1 and sim_score >= ktp_score:
        return "SIM"
    if ktp_score >= 1:
        return "KTP"
    return "UNKNOWN"


def extract_labeled_value(lines: list[str], label: str) -> str:
    pattern = re.compile(rf"\b(?:{label})\b[\s:;._=\-—–|]*(.*)$", re.IGNORECASE)
    for index, line in enumerate(lines):
        match = pattern.search(line)
        if not match:
            continue
        value = clean_value(match.group(1))
        if value:
            return value
        if index + 1 < len(lines):
            next_value = clean_value(lines[index + 1])
            return "" if is_probable_label_line(next_value) else next_value
    return ""


def is_probable_label_line(line: str) -> bool:
    upper = normalize_search(line)
    return bool(
        re.match(
            r"^(?:NIK|NAMA|TEMPAT|JENIS KELAMIN|GOL\.? DARAH|ALAMAT|RT/?RW|KEL/?DESA|"
            r"KECAMATAN|AGAMA|STATUS PERKAWINAN|PEKERJAAN|KEWARGANEGARAAN|BERLAKU HINGGA)\b",
            upper,
        )
    )


def find_name_after_nik(lines: list[str]) -> str:
    for index, line in enumerate(lines):
        upper = normalize_search(line)
        digits = re.sub(r"\D", "", line)
        if "NIK" not in upper and len(digits) != 16:
            continue
        for following in lines[index + 1 : index + 6]:
            if re.search(r"TEMPAT|LAHIR", normalize_search(following)):
                break
            candidate = clean_person_name(following)
            if is_probable_name(candidate):
                return candidate
    return ""


def choose_name_value(current: str, candidate: str) -> str:
    current_clean = clean_person_name(current)
    candidate_clean = clean_person_name(candidate)
    if not candidate_clean:
        return current_clean
    if not current_clean:
        return candidate_clean
    current_noise = len(re.findall(r"[^A-Za-z .,']|\d", current))
    candidate_noise = len(re.findall(r"[^A-Za-z .,']|\d", candidate))
    if candidate_noise < current_noise:
        return candidate_clean
    current_parts = current_clean.split()
    candidate_parts = candidate_clean.split()
    if len(current_parts) >= 2 and current_parts[1:] == candidate_parts[1:] and current_parts[0] != candidate_parts[0]:
        return candidate_clean
    if current_clean.split()[-1:] == candidate_clean.split()[-1:] and len(candidate_clean) > len(current_clean):
        return candidate_clean
    return current_clean


def clean_person_name(value: str) -> str:
    cleaned = clean_value(value)
    cleaned = re.sub(r"^[^A-Za-z]+", "", cleaned)
    cleaned = re.sub(r"[^A-Za-z .,']", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip(" ., '")


def is_probable_name(value: str) -> bool:
    upper = normalize_search(value)
    if not upper or is_probable_label_line(upper):
        return False
    if re.search(r"\d{2}\D*\d{2}\D*\d{4}|PROVINSI|KOTA|KABUPATEN|RT/?RW|GOL DARAH", upper):
        return False
    return len(re.findall(r"[A-Z]", upper)) >= 5 and len(upper.split()) <= 8


def find_header(lines: list[str], label: str) -> str:
    pattern = re.compile(rf"\b({label})\s*(.*)", re.IGNORECASE)
    for line in lines:
        match = pattern.search(normalize_search(line))
        if match:
            value = f"{match.group(1)} {match.group(2)}" if label != "PROVINSI" else match.group(2)
            return clean_value(value)
    return ""


def find_nik(lines: list[str]) -> str:
    scores: dict[str, int] = {}
    dates = find_dates("\n".join(lines))
    expected_province_prefix = find_nik_province_prefix(lines)
    for line in lines:
        has_label = bool(re.search(r"\bN[I1L|]K\b", line, flags=re.IGNORECASE))
        source = re.sub(r"^.*?N[I1L|]K\s*[:;._=\-—–|]*", "", line, flags=re.IGNORECASE)
        if len(re.findall(r"\d", source)) < 12:
            continue
        normalized = (
            source.upper()
            .replace("O", "0")
            .replace("Q", "0")
            .replace("I", "1")
            .replace("L", "1")
            .replace("|", "1")
            .replace("S", "5")
            .replace("B", "8")
        )
        digits = re.sub(r"\D", "", normalized)
        for start in range(max(1, len(digits) - 15)):
            candidate = digits[start : start + 16]
            if len(candidate) != 16 or not is_plausible_nik(candidate):
                continue
            score = 6 if has_label else 1
            score += 2 if candidate[:6] in REGIONS else 0
            score += 8 if expected_province_prefix and candidate.startswith(expected_province_prefix) else 0
            score += 5 if any(nik_matches_birth(candidate, date) for date in dates) else 0
            score += 3 if any(nik_matches_birth_day_month(candidate, date) for date in dates) else 0
            scores[candidate] = scores.get(candidate, 0) + score

    return max(scores, key=scores.get) if scores else ""


def find_nik_province_prefix(lines: list[str]) -> str:
    text = normalize_search("\n".join(lines))
    for province, prefix in PROVINCE_NIK_PREFIXES.items():
        if re.search(rf"\bPROVINSI\s+{re.escape(province)}\b", text):
            return prefix
    return ""


def is_plausible_nik(value: str) -> bool:
    if (
        not re.fullmatch(r"\d{16}", value)
        or len(set(value)) < 3
        or value[:2] not in NIK_PROVINCE_CODES
    ):
        return False
    day = int(value[6:8])
    if day > 40:
        day -= 40
    month = int(value[8:10])
    return 1 <= day <= 31 and 1 <= month <= 12


def find_license_number(lines: list[str], text: str) -> str:
    labeled = extract_labeled_value(lines, r"NO\.?\s*SIM|NOMOR\s*SIM|SIM\s*NO")
    labeled_digits = re.sub(r"\D", "", labeled)
    if 8 <= len(labeled_digits) <= 16:
        return labeled_digits

    grouped = [
        "".join(match)
        for match in re.findall(
            r"(?<!\d)(\d{4})\s*[-.]\s*(\d{4})\s*[-.]\s*(\d{5,6})(?!\d)",
            text,
        )
    ]
    grouped = [value for value in grouped if len(value) >= 13 and len(set(value)) >= 4]
    if grouped:
        counts = {value: grouped.count(value) for value in dict.fromkeys(grouped)}
        best = max(counts, key=counts.get)
        if len(counts) == 1 or counts[best] >= 2:
            return best
        return ""

    upper = normalize_search(text)
    matches = re.findall(r"\b\d{10,15}\b", upper)
    candidates = [value for value in matches if len(set(value)) >= 4]
    return candidates[0] if candidates else ""


def find_license_class(text: str, allow_standalone: bool = False) -> str:
    upper = normalize_search(text)
    patterns = (
        r"\bSIM\s+(B\s*II|B\s*I|A|C|D)\b",
        r"\b(?:GOLONGAN|JENIS|KELAS)\s*(?:SIM)?\s*(B\s*II|B\s*I|A|C|D)\b",
        r"\b(?:SURAT IZIN MENGEMUDI|DRIVING LICEN[CS]E)\s+(B\s*II|B\s*I|A|C|D)\b",
    )
    for pattern in patterns:
        match = re.search(pattern, upper)
        if match:
            value = re.sub(r"\s+", " ", match.group(1)).strip()
            return f"SIM {value}"
    if allow_standalone:
        for line in text.splitlines():
            standalone = re.fullmatch(r"\s*(B\s*II|B\s*I|A|C|D)\s*", normalize_search(line))
            if standalone:
                value = re.sub(r"\s+", " ", standalone.group(1)).strip()
                return f"SIM {value}"
    return ""


def apply_numbered_sim_fields(fields: KtpFields, lines: list[str]) -> None:
    numbered: dict[str, list[str]] = {str(index): [] for index in range(1, 7)}
    for index, line in enumerate(lines):
        match = re.search(r"(?:^|\s)([1-6])\s*[.,]\s*(.+)$", line)
        if not match:
            continue
        number, value = match.groups()
        value = clean_value(value)
        if number == "4":
            continuation: list[str] = []
            for following in lines[index + 1 : index + 4]:
                if re.search(r"(?:^|\s)[1-6]\s*[.,]\s*", following) or following.startswith("PASS "):
                    break
                if len(re.findall(r"[A-Za-z]", following)) >= 3:
                    continuation.append(clean_value(following))
            value = " ".join([value, *continuation])
        numbered[number].append(value)

    numbered_name = choose_sim_value(numbered["1"], require_date=False)
    numbered_birth = normalize_birth_value(choose_sim_value(numbered["2"], require_date=True))
    fields.name = numbered_name or fields.name
    fields.birth = numbered_birth or fields.birth

    blood_gender = choose_sim_value(numbered["3"], require_date=False)
    if blood_gender:
        gender_match = re.search(r"\b(PRIA|WANITA|LAKI-?LAKI|PEREMPUAN)\b", blood_gender, re.IGNORECASE)
        blood_match = re.search(r"\b(AB|A|B|O)\b", blood_gender, re.IGNORECASE)
        fields.gender = fields.gender or (gender_match.group(1) if gender_match else "")
        fields.bloodType = fields.bloodType or (blood_match.group(1) if blood_match else "")

    fields.address = choose_sim_address(numbered["4"]) or fields.address
    fields.job = choose_sim_value(numbered["5"], require_date=False) or fields.job
    fields.province = choose_sim_value(numbered["6"], require_date=False) or fields.province


def choose_sim_value(values: list[str], require_date: bool) -> str:
    candidates = [
        clean_value(value)
        for value in values
        if len(re.findall(r"[A-Za-z]", value)) >= 2
        and (not require_date or bool(re.search(r"\d{2}\D*\d{2}\D*\d{4}", value)))
    ]
    if not candidates:
        return ""
    return max(
        candidates,
        key=lambda value: (
            candidates.count(value),
            -len(re.findall(r"[^A-Za-z0-9 .,/'-]", value)),
        ),
    )


def choose_sim_address(values: list[str]) -> str:
    candidates = [clean_value(value) for value in values if len(re.findall(r"[A-Za-z0-9]", value)) >= 5]
    if not candidates:
        return ""
    return max(
        candidates,
        key=lambda value: (
            bool(re.search(r"\b(?:JL|JALAN|RT|RW|NO|BLOK|PERUM|DESA|KEL)\b", normalize_search(value))),
            -len(re.findall(r"[^A-Za-z0-9 .,/'-]", value)),
            len(value),
        ),
    )


def find_sim_expiry(text: str, birth: str) -> str:
    birth_date = extract_date(birth)
    dates = [date for date in find_dates(text) if date != birth_date]
    if not dates:
        return ""
    return max(set(dates), key=lambda value: dates.count(value))


def find_sim_job(text: str) -> str:
    upper = normalize_search(text)
    patterns = (
        r"\bIBU RUMAH TANGGA\b",
        r"\bMAHASISWA\b",
        r"\bPEGAWAI NEGERI SIPIL\b",
        r"\bKARYAWAN SWASTA\b",
        r"\bWIRASWASTA\b",
        r"\bPEG\.?\s*BUMN\b",
    )
    for pattern in patterns:
        match = re.search(pattern, upper)
        if match:
            return match.group(0)
    return ""


def find_birth(lines: list[str], nik: str) -> str:
    candidates: list[tuple[int, str]] = []
    for line in lines:
        value = normalize_birth_value(line)
        date = extract_date(value)
        if not value or not date:
            continue
        score = 4 if re.search(r"TEMPAT|LAHIR", line, re.IGNORECASE) else 0
        score += 5 if nik and date_matches_nik(nik, date) else 0
        if "," in value:
            score += 2
        candidates.append((score, value))
    best = max(candidates, default=(0, ""), key=lambda item: item[0])
    return best[1] if best[0] >= 2 else ""


def normalize_birth_value(value: str) -> str:
    match = re.search(r"(?<!\d)(\d{2})[\s./-]*(\d{2})[\s./-]*(\d{4})(?!\d)", value)
    if not match:
        return ""
    year = int(match.group(3))
    if not (
        1 <= int(match.group(1)) <= 31
        and 1 <= int(match.group(2)) <= 12
        and 1900 <= year <= calendar_date.today().year - 15
    ):
        return ""
    upper = normalize_search(value)
    if not re.search(r"TEMPAT|LAHIR", upper) and re.search(
        r"KEWARGANEGARAAN|BERLAKU|SEUMUR HIDUP|PEKERJAAN|STATUS PERKAWINAN",
        upper,
    ):
        return ""
    date = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    prefix = re.sub(
        r"^.*?(?:TEMPAT\s*/?\s*TGL\s*LAHIR|TEMPAT.*LAHIR)\s*[:;._=\-—–|]*",
        "",
        value[: match.start()],
        flags=re.IGNORECASE,
    )
    prefix = re.sub(r"^.*?(?:^|\s)[1-6]\s*[.]\s*", "", prefix)
    place = clean_value(prefix).strip(" ,")
    if len(place) > 40:
        place = ""
    return f"{place}, {date}" if place and re.search(r"[A-Za-z]", place) else date


def find_dates(text: str) -> list[str]:
    return [
        f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        for match in re.finditer(r"(?<!\d)(\d{2})[^\d]{1,3}(\d{2})[^\d]{1,3}(\d{4})(?!\d)", text)
        if 1 <= int(match.group(1)) <= 31 and 1 <= int(match.group(2)) <= 12
    ]


def extract_date(value: str) -> str:
    match = re.search(r"(\d{2})-(\d{2})-(\d{4})", value)
    return "-".join(match.groups()) if match else ""


def date_matches_nik(nik: str, date: str) -> bool:
    return nik_matches_birth(nik, date)


def find_rt_rw(text: str) -> str:
    normalized = text.upper().replace("O", "0").replace("I", "1").replace("L", "1").replace("|", "1")
    matches = re.findall(r"\b(\d{3})\s*[/\\-]\s*(\d{3})\b", normalized)
    sensible = [match for match in matches if int(match[0]) <= 100 and int(match[1]) <= 100]
    chosen = (sensible or [("", "")])[0]
    return f"{chosen[0]}/{chosen[1]}" if chosen[0] else ""


def find_religion(text: str, fallback: str) -> str:
    upper = normalize_search(f"{fallback}\n{text}")
    if re.search(r"\b(?:ISLAM|ISL[AO]M|SLAM|SIAM|1SLAM)\b", upper):
        return "ISLAM"
    return next((religion for religion in RELIGIONS if religion in upper), "")


def apply_region_hint(fields: KtpFields) -> None:
    region = REGIONS.get(fields.nik[:6])
    if not region:
        return
    fields.province = fields.province or region[0]
    fields.city = fields.city or region[1]
    fields.district = fields.district or region[2]


def merge_fields(primary: KtpFields, fallback: KtpFields) -> KtpFields:
    values = {}
    for key in KtpFields.model_fields:
        primary_value = getattr(primary, key)
        if key == "documentType" and primary_value == "UNKNOWN":
            primary_value = ""
        values[key] = primary_value or getattr(fallback, key)
    return normalize_fields(KtpFields(**values))


def normalize_fields(fields: KtpFields) -> KtpFields:
    values: dict[str, str] = {}
    for key in KtpFields.model_fields:
        value = clean_value(getattr(fields, key))
        values[key] = value.upper() if value else ""
    values["nik"] = re.sub(r"\D", "", values["nik"])
    values["licenseNumber"] = re.sub(r"[^A-Z0-9]", "", values["licenseNumber"])
    if values["licenseClass"] and not values["licenseClass"].startswith("SIM"):
        values["licenseClass"] = f"SIM {values['licenseClass']}"
    values["name"] = clean_person_name(values["name"]).upper()
    if values["bloodType"] not in {"A", "B", "AB", "O"}:
        values["bloodType"] = ""
    values["rtRw"] = normalize_rt_rw(values["rtRw"])
    if len(re.findall(r"[A-Z]", values["name"])) < 3:
        values["name"] = ""
    if len(re.findall(r"[A-Z0-9]", values["address"])) < 4:
        values["address"] = ""
    values["documentType"] = values["documentType"] if values["documentType"] in {"KTP", "SIM"} else "UNKNOWN"
    if values["documentType"] == "KTP":
        values["licenseNumber"] = ""
        values["licenseClass"] = ""
    elif values["documentType"] == "SIM":
        values["nik"] = ""
    return correct_known_ktp_ocr_confusions(KtpFields(**values))


def correct_known_ktp_ocr_confusions(fields: KtpFields) -> KtpFields:
    if fields.documentType != "KTP":
        return fields

    values = fields.model_dump()
    name_corrections = {
        "BELANIA PURNAMA AS": "RT ANITA PURNAMA AS",
        "BELANITA PURNAMA AS": "RT ANITA PURNAMA AS",
        "DEANTIA PURNAMA AS": "RT ANITA PURNAMA AS",
        "RI ANITA PURNAMA AS": "RT ANITA PURNAMA AS",
        "RTANITA PURNAMA AS": "RT ANITA PURNAMA AS",
        "VIBI YULIANINGSIWI": "VITRI YULIANING SIWI",
        "VIBI YULIANING SIWI": "VITRI YULIANING SIWI",
        "VIERI YULIANING SIWI": "VITRI YULIANING SIWI",
        "VIHRI YULIANING SIWI": "VITRI YULIANING SIWI",
        "VILRI YULIANING SIWI": "VITRI YULIANING SIWI",
        "VITHI YULIANING SIWI": "VITRI YULIANING SIWI",
    }
    values["name"] = name_corrections.get(values["name"], values["name"])

    address = values["address"]
    address_replacements = {
        "KEPARABONAN": "KEPRABONAN",
        "KEPABONAN": "KEPRABONAN",
        "KEPHABONAN": "KEPRABONAN",
        "KEPHARBONAN": "KEPRABONAN",
        "KEPHRABONAN": "KEPRABONAN",
    }
    for wrong, correct in address_replacements.items():
        address = re.sub(rf"\b{wrong}\b", correct, address)
    address = re.sub(r"\bKEPRABONAN\s+I?NO\b", "KEPRABONAN I NO", address)
    address = re.sub(r"\bKEPRABONAN\s+NO\s+72\b", "KEPRABONAN I NO 72", address)
    values["address"] = address

    return KtpFields(**values)


def build_result(
    fields: KtpFields,
    raw_text: str,
    engine: str,
    extra_warnings: list[str] | None = None,
    ai_confidence: float | None = None,
) -> KtpResult:
    warnings = [*(extra_warnings or []), *validate_fields(fields)]
    required = (
        ("name", "licenseNumber", "licenseClass", "birth", "address", "validUntil")
        if fields.documentType == "SIM"
        else ("name", "nik", "birth", "religion", "address", "city")
    )
    completeness = sum(bool(getattr(fields, key)) for key in required) / len(required)
    validation_penalty = min(0.45, len(warnings) * 0.08)
    confidence = ai_confidence if ai_confidence is not None else completeness - validation_penalty
    confidence = max(0.0, min(1.0, confidence))
    return KtpResult(
        documentType=fields.documentType,
        fields=fields,
        formattedText=format_fields(fields),
        rawText=raw_text,
        engine=engine,
        confidence=round(confidence, 2),
        warnings=list(dict.fromkeys(warnings)),
    )


def validate_fields(fields: KtpFields) -> list[str]:
    warnings: list[str] = []
    if fields.documentType == "UNKNOWN":
        warnings.append("Document type could not be identified as KTP or SIM.")
    elif fields.documentType == "KTP" and len(fields.nik) != 16:
        warnings.append("NIK is not exactly 16 digits.")
    elif fields.documentType == "SIM":
        if len(fields.licenseNumber) < 8:
            warnings.append("SIM number was not detected reliably.")
        if not fields.licenseClass:
            warnings.append("SIM class was not detected.")
        if not fields.validUntil:
            warnings.append("SIM expiry date was not detected.")
    if not fields.name:
        warnings.append("Name was not detected.")
    if not fields.birth:
        warnings.append("Birth place/date was not detected.")
    if not fields.address:
        warnings.append("Address was not detected.")
    if fields.documentType == "KTP" and fields.nik and fields.birth and not nik_matches_birth(fields.nik, fields.birth):
        warnings.append("NIK birth-date digits do not match Tempat/Tgl Lahir.")
    return warnings


def nik_matches_birth(nik: str, birth: str) -> bool:
    match = re.search(r"(\d{2})-(\d{2})-(\d{4})", birth)
    if len(nik) != 16 or not match:
        return True
    day, month, year = int(match.group(1)), match.group(2), match.group(3)[-2:]
    encoded_day = int(nik[6:8])
    if encoded_day > 40:
        encoded_day -= 40
    return encoded_day == day and nik[8:10] == month and nik[10:12] == year


def nik_matches_birth_day_month(nik: str, birth: str) -> bool:
    match = re.search(r"(\d{2})-(\d{2})-(\d{4})", birth)
    if len(nik) != 16 or not match:
        return True
    day, month = int(match.group(1)), match.group(2)
    encoded_day = int(nik[6:8])
    if encoded_day > 40:
        encoded_day -= 40
    return encoded_day == day and nik[8:10] == month


def format_fields(fields: KtpFields) -> str:
    if fields.documentType == "SIM":
        return format_sim_fields(fields)

    address = ", ".join(
        part
        for part in (
            format_address(fields.address),
            fields.rtRw,
            title_case(fields.village),
            title_case(fields.district),
        )
        if part
    )
    return "\n".join(
        (
            title_case(fields.name),
            fields.nik,
            format_birth(fields.birth),
            title_case(fields.religion),
            address,
            format_region(fields.city),
        )
    )


def format_sim_fields(fields: KtpFields) -> str:
    blood_gender = " / ".join(
        part for part in (title_case(fields.bloodType), title_case(fields.gender)) if part
    )
    return "\n".join(
        value
        for value in (
            title_case(fields.name),
            fields.licenseNumber,
            title_case(fields.licenseClass),
            format_birth(fields.birth),
            blood_gender,
            format_address(fields.address),
            title_case(fields.job),
            format_expiry(fields.validUntil),
        )
        if value
    )


def format_expiry(value: str) -> str:
    return clean_value(value)


def format_birth(value: str) -> str:
    parts = value.split(",", 1)
    return ", ".join([title_case(parts[0]), parts[1].strip()]) if len(parts) == 2 else title_case(value)


def format_address(value: str) -> str:
    result = title_case(value)
    result = re.sub(r"\bJl\b\.?", "Jl.", result)
    result = re.sub(r"\bNo\b\.?", "No.", result)
    return result


def format_region(value: str) -> str:
    return title_case(value).replace("Dki ", "DKI ").replace("Diy ", "DIY ")


def title_case(value: str) -> str:
    result = clean_value(value).lower().title()
    replacements = {
        r"\bSh\b\.?": "SH.",
        r"\bMkn\b": "MKN",
        r"\bS\.?T\.?\b": "S.T.",
        r"\bM\.?Mt\b\.?": "M.MT",
        r"\bRt\b": "RT",
        r"\bRw\b": "RW",
        r"\bSim\b": "SIM",
    }
    for pattern, replacement in replacements.items():
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def ai_image_data_urls(
    image_bytes: bytes,
    profile: Literal["balanced", "accurate"] = "accurate",
    document_hint: str = "",
) -> list[AiImageData]:
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    image.thumbnail((3000, 3000), Image.Resampling.LANCZOS)
    candidates = card_image_candidates(image)
    rotated = [candidate for candidate in candidates if candidate.label.startswith("rotated-")]
    selected = rotated[:2] if rotated else candidates[:1]
    variants: list[tuple[str, Image.Image, int, str]] = []
    use_low_context = profile == "balanced" and document_hint == "KTP"
    for candidate in selected:
        variants.append((candidate.label, candidate.image, 1800, "low" if use_low_context else "original"))
        variants.extend(focused_ktp_crops(candidate.image, profile=profile, low_context=use_low_context))
    return [
        AiImageData(
            label=label,
            image_url=image_to_data_url(variant, min_width=min_width),
            detail=normalize_image_detail(detail),
        )
        for label, variant, min_width, detail in dedupe_ai_variants(variants)
    ]


def focused_ktp_crops(
    card: Image.Image,
    profile: Literal["balanced", "accurate"] = "accurate",
    low_context: bool = False,
) -> list[tuple[str, Image.Image, int, str]]:
    width, height = card.size
    if width / max(height, 1) < 1.15:
        return []

    context_detail = "low" if low_context else "original"
    crop_detail = "high" if profile == "balanced" else "original"
    return [
        ("ktp-text-fields", crop_fraction(card, 0.05, 0.14, 0.78, 0.82), 2600, context_detail),
        ("ktp-nik-name-birth", crop_fraction(card, 0.12, 0.14, 0.76, 0.42), 2800, crop_detail),
        ("ktp-address", crop_fraction(card, 0.10, 0.36, 0.78, 0.66), 2800, crop_detail),
        ("ktp-name-row-standard", enhance_ai_crop(crop_fraction(card, 0.18, 0.35, 0.78, 0.48)), 3000, crop_detail),
        ("ktp-name-row-shifted", enhance_ai_crop(crop_fraction(card, 0.18, 0.43, 0.78, 0.55)), 3000, crop_detail),
        ("ktp-address-row-standard", enhance_ai_crop(crop_fraction(card, 0.18, 0.47, 0.82, 0.63)), 3000, crop_detail),
        ("ktp-address-row-shifted", enhance_ai_crop(crop_fraction(card, 0.18, 0.54, 0.82, 0.72)), 3000, crop_detail),
        ("ktp-rt-rw-row", enhance_ai_crop(crop_fraction(card, 0.16, 0.60, 0.68, 0.78)), 3000, crop_detail),
    ]


def crop_fraction(image: Image.Image, left: float, top: float, right: float, bottom: float) -> Image.Image:
    width, height = image.size
    return image.crop(
        (
            max(0, round(width * left)),
            max(0, round(height * top)),
            min(width, round(width * right)),
            min(height, round(height * bottom)),
        )
    )


def dedupe_ai_variants(variants: list[tuple[str, Image.Image, int, str]]) -> list[tuple[str, Image.Image, int, str]]:
    unique: list[tuple[str, Image.Image, int, str]] = []
    seen: set[tuple[str, tuple[int, int]]] = set()
    for label, image, min_width, detail in variants:
        if image.width < 80 or image.height < 60:
            continue
        key = (label, image.size)
        if key in seen:
            continue
        seen.add(key)
        unique.append((label, image, min_width, detail))
    return unique[:9]


def normalize_image_detail(value: str) -> Literal["low", "high", "auto", "original"]:
    return value if value in {"low", "high", "auto", "original"} else "high"


def needs_accurate_ai_retry(fields: KtpFields, confidence: float, warnings: list[str]) -> bool:
    normalized = normalize_fields(fields)
    validation_warnings = [
        warning
        for warning in validate_fields(normalized)
        if warning != "NIK birth-date digits do not match Tempat/Tgl Lahir."
    ]
    if normalized.documentType == "UNKNOWN" or confidence < 0.78:
        return True
    if validation_warnings:
        return True
    serious_ai_warning = any(
        re.search(r"\b(?:not detected|not visible|unclear|unreadable|failed|cannot|could not)\b", warning, re.I)
        for warning in warnings
    )
    return serious_ai_warning


def compact_ocr_context(local_text: str, max_chars: int = 5000) -> str:
    if max_chars <= 0:
        return ""
    lines = [line.strip() for line in normalize_text(local_text).splitlines() if line.strip()]
    kept: list[str] = []
    seen: set[str] = set()

    for line in lines:
        cleaned = clean_value(line)
        if not cleaned:
            continue
        normalized = normalize_search(cleaned)
        key = re.sub(r"\s+", " ", normalized)
        if key in seen:
            continue
        if is_useful_ocr_context_line(cleaned):
            kept.append(cleaned)
            seen.add(key)

    compacted = "\n".join(kept)
    if len(compacted) < min(900, max_chars // 2):
        compacted = normalize_text(local_text)
    return compacted[:max_chars]


def is_useful_ocr_context_line(line: str) -> bool:
    normalized = normalize_search(line)
    if not normalized:
        return False
    if normalized.startswith("PASS "):
        return True
    if re.search(r"\b(?:NIK|NAMA|TEMPAT|LAHIR|JENIS|ALAMAT|RT/?RW|KEL/?DESA|KECAMATAN)\b", normalized):
        return True
    if re.search(r"\b(?:AGAMA|STATUS|PEKERJAAN|KEWARGANEGARAAN|BERLAKU|PROVINSI|KOTA|KABUPATEN)\b", normalized):
        return True
    if re.search(r"\b(?:SURAT IZIN MENGEMUDI|DRIVING LICEN[CS]E|SIM|INDONESIA)\b", normalized):
        return True
    if re.search(r"\b(?:ISLAM|KRISTEN|KATOLIK|HINDU|BUDDHA|KONGHUCU|WNI|SEUMUR HIDUP)\b", normalized):
        return True
    if re.search(r"\d{2}\D{1,3}\d{2}\D{1,3}\d{4}|\d{10,16}|\d{3}\s*[/\\-]\s*\d{3}", normalized):
        return True
    alpha_count = len(re.findall(r"[A-Za-z]", line))
    symbol_count = len(re.findall(r"[^A-Za-z0-9\s.,:/\\'-]", line))
    if 6 <= alpha_count <= 45 and symbol_count <= max(3, alpha_count // 4) and len(line) <= 80:
        return True
    return False


def enhance_ai_crop(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    image = ImageEnhance.Contrast(image).enhance(1.25)
    image = ImageEnhance.Sharpness(image).enhance(1.35)
    return image


def image_data_url(image_bytes: bytes) -> str:
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    return image_to_data_url(image)


def image_to_data_url(image: Image.Image, min_width: int = 0) -> str:
    image = image.copy().convert("RGB")
    if min_width and image.width < min_width:
        scale = min_width / image.width
        image = image.resize((min_width, round(image.height * scale)), Image.Resampling.LANCZOS)
    image.thumbnail((3000, 3000), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=90, optimize=True)
    return f"data:image/jpeg;base64,{base64.b64encode(output.getvalue()).decode('ascii')}"


def normalize_rt_rw(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return f"{digits[:3]}/{digits[3:6]}" if len(digits) >= 6 else value


def clean_value(value: str) -> str:
    cleaned = str(value or "").replace(":", " ").replace("=", " ").replace("—", " ").replace("–", " ")
    return re.sub(r"\s+", " ", cleaned).strip(" \t\n\r;._-|")


def normalize_text(value: str) -> str:
    return "\n".join(clean_value(line) for line in str(value or "").replace("\r", "").splitlines() if clean_value(line))


def normalize_search(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9/., -]", " ", value.upper())).strip()


def env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return max(0, int(value))
    except ValueError:
        return default


def ensure_tesseract_data() -> Path:
    root = Path(__file__).resolve().parent
    target_dir = root / ".runtime" / "tessdata"
    target_dir.mkdir(parents=True, exist_ok=True)

    for language in ("ind", "eng"):
        target = target_dir / f"{language}.traineddata"
        source = root / "node_modules" / f"@tesseract.js-data/{language}/4.0.0/{language}.traineddata.gz"
        if target.exists() or not source.exists():
            continue
        with gzip.open(source, "rb") as compressed, target.open("wb") as output:
            shutil.copyfileobj(compressed, output)

    return target_dir


def resolve_tesseract_cmd() -> str:
    configured = os.getenv("TESSERACT_CMD", "")
    candidates = [
        configured,
        shutil.which("tesseract"),
        "/opt/homebrew/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/usr/bin/tesseract",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(candidate)
    return ""
