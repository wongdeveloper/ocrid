# Indonesia ID Intelligence

A Python and AI-assisted application for automatically detecting and reading Indonesian KTP identity cards and SIM driver licenses.

## Run locally

```bash
npm install
npm run setup:python
npm run start
```

Then open:

```text
http://localhost:6017
```

The Python FastAPI server exposes:

```text
GET /health
POST /api/ocr
GET /webhook
POST /webhook
```

## Extraction engines

- `Automatic hybrid`: Uses AI vision when `OPENAI_API_KEY` is configured; otherwise uses Python local OCR.
- `AI vision`: Detects KTP versus SIM, then sends the image and local OCR candidates to the configured OpenAI model for schema-validated fields.
- `Python local OCR`: Uses OpenCV, Pillow, and Tesseract without sending the image to an AI provider.
- `Browser OCR`: Uses the original local Tesseract.js workflow.

AI mode is designed to improve difficult names, addresses, titles, license numbers, and low-quality OCR. Results include the detected document type, engine, confidence score, and validation warnings. Always review identity data before using it in another system.

## Enable AI vision

```bash
cp .env.example .env
```

Set these values in `.env`:

```env
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-5.5
OPENAI_OCR_MODEL=gpt-4.1
OPENAI_OCR_ADAPTIVE=true
```

Restart `npm run start` after changing `.env`. `OPENAI_OCR_MODEL` is optional; when present, the OCR pipeline uses it for image extraction while `OPENAI_MODEL` can remain your general default. AI mode sends the KTP or SIM image to the configured OpenAI API account. Leave `OPENAI_API_KEY` empty to keep processing local.

`OPENAI_OCR_ADAPTIVE=true` reduces average token usage by sending broad KTP context images at low detail, keeping the focused NIK/name/address/RT-RW crops at high detail, and retrying with the full accurate payload only when validation detects an incomplete or risky extraction. Set `OPENAI_OCR_ADAPTIVE=false` to force the previous full-detail single-pass behavior.

## Batch testing

Run the same extraction pipeline against multiple images and save a detailed JSON report:

```bash
.venv/bin/python scripts/batch_test.py /path/to/images/*.jpeg \
  --mode local \
  --json reports/batch-results.json
```

Use `--mode auto` to use AI vision when `OPENAI_API_KEY` is configured.
The batch command loads `.env` from the project root and reports AI results and local fallbacks separately.

## WhatsApp Cloud API

This uses the official Meta WhatsApp Business Cloud API webhook flow.

1. Copy `.env.example` to `.env`.
2. Fill `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `GRAPH_API_VERSION`.
3. Run `npm run start`.
4. Expose this local server through a public HTTPS URL for development, for example with ngrok or Cloudflare Tunnel.
5. In Meta Developers, set the webhook callback URL to:

```text
https://YOUR_PUBLIC_HOST/webhook
```

Use the same value as `WHATSAPP_VERIFY_TOKEN` in the Meta webhook verification screen, and subscribe the WhatsApp `messages` webhook field.

When a user sends an image message, the server downloads it, detects whether it is a KTP or SIM, extracts the relevant fields, and replies with the matching formatted output.

KTP output:
```text
Nama
NIK
Tempat/Tgl Lahir
Agama
Alamat, RT/RW, Kel/Desa, Kecamatan
Kabupaten/Kota
```

SIM output:

```text
Nama
No. SIM
Jenis SIM
Tempat/Tgl Lahir
Gol. Darah / Jenis Kelamin
Alamat
Pekerjaan
Berlaku Sampai
```

References:

- Meta WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
- Media download: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
- Send messages: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
- OpenAI image inputs: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs

## WhatsApp Web QR worker

This optional worker uses `whatsapp-web.js` and a linked personal or business WhatsApp account. It does not require Meta webhook credentials or a public HTTPS tunnel.

Start the OCR API in the first terminal:

```bash
npm run start
```

Start the WhatsApp worker in a second terminal:

```bash
npm run start:whatsapp-web
```

Scan the terminal QR code from **WhatsApp > Settings > Linked devices > Link a device**. The authenticated session is stored under `.wwebjs_auth`, so the QR code is normally needed only once. Incoming KTP/SIM photos are sent to the local Python OCR API and the formatted result is replied to the sender.

You can also open the current QR code at:

```text
http://127.0.0.1:3001/whatsapp/qr.svg
```

Worker status:

```bash
curl http://127.0.0.1:3001/whatsapp/status
```

The status response includes `lastMessage` and `messageStats`. If an image is not processed, check `lastMessage.reason`. Common reasons are `group_messages_disabled` for group chats and `from_me_disabled` when testing by sending an image from the same WhatsApp account that is linked as the worker. Set `WHATSAPP_WEB_ALLOW_GROUPS=true` to process groups. For own-account media testing, set `WHATSAPP_WEB_PROCESS_OWN_MESSAGES=true`; own non-media messages are still ignored to avoid reply loops.

WhatsApp OCR requests wait up to 10 minutes by default. Override this with `WHATSAPP_OCR_TIMEOUT_MS` in the deployed `.env` file if large images need more time, for example `WHATSAPP_OCR_TIMEOUT_MS=900000`.

Send a WhatsApp message directly:

```bash
curl -X POST http://127.0.0.1:3001/whatsapp/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_WHATSAPP_BRIDGE_API_KEY' \
  -d '{"phoneNumbers":["628123456789"],"message":"Tes OCRID"}'
```

The `x-api-key` header is required only when `WHATSAPP_BRIDGE_API_KEY` is set. Phone numbers may use `08...`, `8...`, or `62...`; they are normalized to Indonesia's `62` country code. Group processing is disabled unless `WHATSAPP_WEB_ALLOW_GROUPS=true`.

`whatsapp-web.js` is an unofficial WhatsApp Web client. It can break when WhatsApp changes its web application and carries account-blocking risk. Use the official Meta Cloud API integration above for production-critical or policy-sensitive deployments.

## Jenkins CI

The repository includes a `Jenkinsfile` for a Pipeline job. It installs Node and Python dependencies, blocks accidental `.env` commits, then runs:

```bash
npm run test:python
npm run test:whatsapp-web
```

Jenkins agent requirements:

- Python 3.12 or newer
- `curl` or `wget` if Node.js 18+ is not already installed. The pipeline bootstraps Node.js 20 into the Jenkins workspace when system Node is missing.
- `rsync` for copying the application to the target server.
- Jenkins SSH Agent plugin, with **SSH Username with private key** credentials:
  - `ocrid-dev-ssh` for `DEV1` deployments to `devocrid.wong.systems`
  - `ocrid-prod-ssh` for `main`/`master` deployments to `ocrid.wong.systems`
- Jenkins Credentials Binding plugin, with **Secret file** credentials containing the full `.env` file:
  - `ocrid-dev-env` for `DEV1`
  - `ocrid-prod-env` for `main`/`master`
- The SSH credential username should match `DEV_DEPLOY_USER` or `PROD_DEPLOY_USER` in `Jenkinsfile`, currently `deploy`.

Target server requirements:

- `rsync`, `python3`, `systemd`, and Nginx.
- `curl` or `wget` if Node.js 18+ is not already installed on the target. The deployment bootstraps Node.js 20 under the app directory when needed.
- `apt-get` on Ubuntu/Debian targets. The deployment installs `tesseract-ocr`, `tesseract-ocr-eng`, and `tesseract-ocr-ind` automatically when the `tesseract` executable is missing.
- If the deploy user is not `root`, it must be able to run `sudo -n` for systemd and Nginx setup/reload without an interactive password.

`DEV1` deploys to `/home/deploy/ocrid-dev` with services `ocrid-dev-api` and `ocrid-dev-whatsapp`. `main`/`master` deploys to `/home/deploy/ocrid` with services `ocrid-api` and `ocrid-whatsapp`.

For a `deploy` user, configure passwordless sudo on each target server:

```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/install, /usr/bin/ln, /usr/sbin/nginx, /bin/systemctl, /usr/bin/systemctl, /usr/sbin/service, /usr/bin/service' | sudo tee /etc/sudoers.d/ocrid-deploy
sudo chmod 0440 /etc/sudoers.d/ocrid-deploy
sudo visudo -cf /etc/sudoers.d/ocrid-deploy
```

The pipeline resolves the exact command paths on the target server with `command -v`. If your server uses different paths, update `/etc/sudoers.d/ocrid-deploy` to match:

```bash
command -v apt-get install ln nginx systemctl service
```

If you prefer root SSH, set `DEV_DEPLOY_USER` and/or `PROD_DEPLOY_USER` to `root` in `Jenkinsfile` and store the matching root private key in the Jenkins SSH credential.

If `python3 -m venv` is unavailable on the Jenkins agent, the pipeline downloads PyPA `virtualenv.pyz` into the workspace and creates `.venv` without sudo.

Create a Jenkins Pipeline job with **Pipeline script from SCM**:

- SCM: Git
- Repository URL: `https://github.com/wongdeveloper/ocrid.git`
- Branch specifier: `*/DEV1`
- Script path: `Jenkinsfile`

Do not commit `.env`. The deployment excludes `.env` from source sync, then uploads the branch-specific Jenkins Secret file credential to the target app directory as `.env` with `0600` permissions. Store production secrets such as `OPENAI_API_KEY`, WhatsApp keys, and bridge API keys in `ocrid-dev-env` or `ocrid-prod-env`.

The deployment stages connect with `sshagent`, sync the app, upload `.env` from Jenkins credentials, install dependencies, create or update systemd services, restart the OCR API and WhatsApp worker, and wait for both local health endpoints before configuring Nginx. The Nginx stage copies a generated config to the target server, then uses remote `sudo -n` to create the matching file under `/etc/nginx/sites-available`, enable it in `/etc/nginx/sites-enabled`, validate with `nginx -t`, and reload Nginx. `DEV1` deploys to `devocrid.wong.systems`; `main`/`master` deploys to `ocrid.wong.systems`. Other branches run tests but skip deployment. The config proxies `/` to the OCR API on `127.0.0.1:6017` and `/whatsapp/` to the WhatsApp worker on `127.0.0.1:3001`. If the existing Nginx site already contains Certbot `/etc/letsencrypt` SSL directives, Jenkins preserves those directives and writes an HTTPS server block plus an HTTP-to-HTTPS redirect instead of replacing the site with HTTP only.

## Run Automatically On Mac

For a local Mac that should keep OCRID running after login, install the included `launchd` LaunchAgents. This starts both services:

- Python OCR API on `http://127.0.0.1:6017`
- WhatsApp Web worker on `http://127.0.0.1:3001`

Install or restart the background agents:

```bash
npm run macos:install
```

If this project is located under `~/Documents`, the installer mirrors it to `~/OCRID-launchd` before creating the agents. macOS privacy controls can block background services from reading `Documents`, even when Terminal can read it. Re-run `npm run macos:install` after code or `.env` changes to refresh that runtime copy.

Check whether both services are loaded and responding:

```bash
npm run macos:status
```

View logs:

```bash
tail -f logs/ocr-api.err.log logs/whatsapp-web.err.log
```

Remove the background agents:

```bash
npm run macos:uninstall
```

The WhatsApp linked-device session under `.wwebjs_auth` is preserved when uninstalling. Stop any manually running `npm run start:python` or `npm run start:whatsapp-web` terminals before installing, otherwise the launchd agents may hit port conflicts.

## Notes

- The default runtime is Python FastAPI. The previous Node server remains available through `npm run start:node`.
- WhatsApp and browser API uploads use the same Python extraction and validation pipeline.
- Local Python OCR requires the `tesseract` executable. Indonesian language data can be enabled with `TESSERACT_LANGUAGE=ind+eng`.
- The formatted export automatically switches between the KTP and SIM field layouts.
