from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from ktp_ai import KtpExtractor


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

PORT = int(os.getenv("PORT", "6017"))
WEBHOOK_PATH = "/" + os.getenv("WHATSAPP_WEBHOOK_PATH", "webhook").strip("/")
VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
META_APP_SECRET = os.getenv("META_APP_SECRET", "")
GRAPH_API_VERSION = os.getenv("GRAPH_API_VERSION", "v23.0")
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

extractor = KtpExtractor()
processed_messages: set[str] = set()
app = FastAPI(title="Indonesia ID AI Reader", version="3.0.0")


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "runtime": "python-fastapi",
        "aiConfigured": extractor.ai_configured,
        "aiModel": extractor.openai_model if extractor.ai_configured else None,
        "aiOcrModel": extractor.openai_ocr_model if extractor.ai_configured else None,
        "localOcr": extractor.local_ocr_available,
        "supportedDocuments": ["KTP", "SIM"],
        "whatsappConfigured": bool(ACCESS_TOKEN and PHONE_NUMBER_ID and VERIFY_TOKEN),
        "webhookPath": WEBHOOK_PATH,
    }


@app.post("/api/ocr")
async def api_ocr(
    image: UploadFile = File(...),
    mode: str = Query("auto", pattern="^(auto|ai|local)$"),
) -> JSONResponse:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image.")
    image_bytes = await image.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds the 20 MB limit.")
    try:
        result = await asyncio.to_thread(extractor.extract, image_bytes, mode)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Identity-document extraction failed: {exc}") from exc
    return JSONResponse(result.model_dump())


@app.get(WEBHOOK_PATH)
async def verify_webhook(request: Request) -> Response:
    query = request.query_params
    if VERIFY_TOKEN and query.get("hub.mode") == "subscribe" and query.get("hub.verify_token") == VERIFY_TOKEN:
        return PlainTextResponse(query.get("hub.challenge", ""))
    raise HTTPException(status_code=403, detail="Invalid webhook verification token.")


@app.post(WEBHOOK_PATH)
async def receive_webhook(request: Request, background_tasks: BackgroundTasks) -> dict:
    raw_body = await request.body()
    if not verify_meta_signature(raw_body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(status_code=401, detail="Invalid Meta signature.")
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON.") from exc
    for event in extract_messages(payload):
        background_tasks.add_task(handle_whatsapp_message, event)
    return {"ok": True}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(ROOT / "index.html")


@app.get("/app.js")
async def frontend_javascript() -> FileResponse:
    return FileResponse(ROOT / "app.js")


@app.get("/styles.css")
async def frontend_styles() -> FileResponse:
    return FileResponse(ROOT / "styles.css")


async def handle_whatsapp_message(event: dict) -> None:
    message = event["message"]
    sender = message.get("from")
    message_id = message.get("id")
    if not sender or not message_id or message_id in processed_messages:
        return
    remember_message(message_id)
    if message.get("type") != "image" or not message.get("image", {}).get("id"):
        await send_whatsapp_text(
            sender,
            "Kirim foto KTP atau SIM sebagai gambar untuk diproses otomatis.",
            event["phoneNumberId"],
        )
        return
    try:
        image_bytes = await download_whatsapp_media(message["image"]["id"])
        result = await asyncio.to_thread(extractor.extract, image_bytes, "auto")
        reply = result.formattedText
        if result.warnings:
            reply += "\n\nPerlu diperiksa:\n- " + "\n- ".join(result.warnings)
        await send_whatsapp_text(sender, reply, event["phoneNumberId"])
    except Exception as exc:
        print(f"WhatsApp identity-document processing failed: {exc}")
        await send_whatsapp_text(
            sender,
            "Maaf, foto KTP/SIM belum berhasil diproses. Kirim ulang foto yang terang, dekat, dan tidak blur.",
            event["phoneNumberId"],
        )


async def download_whatsapp_media(media_id: str) -> bytes:
    if not ACCESS_TOKEN:
        raise RuntimeError("WHATSAPP_ACCESS_TOKEN is not configured.")
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    async with httpx.AsyncClient(timeout=45) as client:
        metadata = await client.get(f"{GRAPH_BASE_URL}/{media_id}", headers=headers)
        metadata.raise_for_status()
        media_url = metadata.json()["url"]
        response = await client.get(media_url, headers=headers)
        response.raise_for_status()
        return response.content


async def send_whatsapp_text(to: str, body: str, source_phone_number_id: str = "") -> None:
    phone_number_id = source_phone_number_id or PHONE_NUMBER_ID
    if not ACCESS_TOKEN or not phone_number_id:
        print("WhatsApp send skipped because credentials are missing.")
        print(body)
        return
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as client:
        for start in range(0, len(body), 3900):
            response = await client.post(
                f"{GRAPH_BASE_URL}/{phone_number_id}/messages",
                headers=headers,
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to,
                    "type": "text",
                    "text": {"preview_url": False, "body": body[start : start + 3900]},
                },
            )
            response.raise_for_status()


def extract_messages(payload: dict) -> list[dict]:
    events: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            phone_number_id = value.get("metadata", {}).get("phone_number_id", PHONE_NUMBER_ID)
            for message in value.get("messages", []):
                events.append({"message": message, "phoneNumberId": phone_number_id})
    return events


def verify_meta_signature(body: bytes, signature: str | None) -> bool:
    if not META_APP_SECRET:
        return True
    expected = "sha256=" + hmac.new(META_APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return bool(signature and hmac.compare_digest(expected, signature))


def remember_message(message_id: str) -> None:
    processed_messages.add(message_id)
    if len(processed_messages) > 500:
        processed_messages.pop()


app.mount("/node_modules", StaticFiles(directory=ROOT / "node_modules"), name="node_modules")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False, loop="asyncio")
