pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    PIP_DISABLE_PIP_VERSION_CHECK = '1'
    PYTHONUNBUFFERED = '1'
    NODE_VERSION = '20.19.5'
    LOCAL_NODE_BIN = "${WORKSPACE}/.jenkins/node/bin"
    DEV_BRANCH = 'DEV1'
    PROD_BRANCH = 'main'
    DEV_DEPLOY_USER = 'deploy'
    PROD_DEPLOY_USER = 'deploy'
    DEV_DEPLOY_HOST = 'devocrid.wong.systems'
    PROD_DEPLOY_HOST = 'ocrid.wong.systems'
    DEV_APP_DIR = '/home/deploy/ocrid-dev'
    PROD_APP_DIR = '/home/deploy/ocrid'
    DEV_API_SERVICE = 'ocrid-dev-api'
    PROD_API_SERVICE = 'ocrid-api'
    DEV_WHATSAPP_SERVICE = 'ocrid-dev-whatsapp'
    PROD_WHATSAPP_SERVICE = 'ocrid-whatsapp'
    DEV_SSH_CREDENTIALS = 'ocrid-dev-ssh'
    PROD_SSH_CREDENTIALS = 'ocrid-prod-ssh'
    DEV_ENV_CREDENTIALS = 'ocrid-dev-env'
    PROD_ENV_CREDENTIALS = 'ocrid-prod-env'
    PROD_NGINX_SERVER_NAME = 'ocrid.wong.systems'
    DEV_NGINX_SERVER_NAME = 'devocrid.wong.systems'
    OCR_API_UPSTREAM = 'http://127.0.0.1:6017'
    WHATSAPP_UPSTREAM = 'http://127.0.0.1:3001'
  }

  stages {
    stage('Bootstrap Tooling') {
      steps {
        sh '''
          set -eu
          export PATH="${LOCAL_NODE_BIN}:$PATH"

          node_major() {
            node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
          }

          if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; then
            echo "Using system Node: $(command -v node)"
          else
            arch="$(uname -m)"
            case "$arch" in
              x86_64|amd64) node_arch="x64" ;;
              aarch64|arm64) node_arch="arm64" ;;
              *)
                echo "Unsupported Jenkins agent architecture for bundled Node: $arch"
                exit 1
                ;;
            esac

            node_parent="${WORKSPACE}/.jenkins"
            node_dir="${node_parent}/node-v${NODE_VERSION}-linux-${node_arch}"
            node_link="${node_parent}/node"
            tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
            url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"

            if [ ! -x "${node_dir}/bin/node" ]; then
              echo "Installing Node ${NODE_VERSION} for ${node_arch} into ${node_dir}"
              tmp_dir="$(mktemp -d)"
              trap 'rm -rf "$tmp_dir"' EXIT
              mkdir -p "$node_parent"
              if command -v curl >/dev/null 2>&1; then
                curl -fsSL "$url" -o "${tmp_dir}/${tarball}"
              elif command -v wget >/dev/null 2>&1; then
                wget -q "$url" -O "${tmp_dir}/${tarball}"
              else
                echo "curl or wget is required to bootstrap Node on this Jenkins agent."
                exit 1
              fi
              tar -xJf "${tmp_dir}/${tarball}" -C "$node_parent"
            fi

            ln -sfn "$node_dir" "$node_link"
          fi

          node --version
          npm --version
          python3 --version
        '''
      }
    }

    stage('Secret Guard') {
      steps {
        sh '''
          set -eu
          if git ls-files --error-unmatch .env >/dev/null 2>&1; then
            echo ".env must not be committed. Use Jenkins credentials/environment variables instead."
            exit 1
          fi
        '''
      }
    }

    stage('Install Node') {
      steps {
        sh '''
          set -eu
          export PATH="${LOCAL_NODE_BIN}:$PATH"
          npm ci
        '''
      }
    }

    stage('Install Python') {
      steps {
        sh '''
          set -eu

          rm -rf .venv
          if python3 -m venv .venv; then
            echo "Created Python virtual environment with python3 -m venv."
          else
            echo "python3 venv support is unavailable; bootstrapping virtualenv in the workspace."
            rm -rf .venv
            mkdir -p .jenkins
            virtualenv_pyz=".jenkins/virtualenv.pyz"
            if [ ! -s "$virtualenv_pyz" ]; then
              if command -v curl >/dev/null 2>&1; then
                curl -fsSL https://bootstrap.pypa.io/virtualenv.pyz -o "$virtualenv_pyz"
              elif command -v wget >/dev/null 2>&1; then
                wget -q https://bootstrap.pypa.io/virtualenv.pyz -O "$virtualenv_pyz"
              else
                echo "curl or wget is required to bootstrap virtualenv."
                exit 1
              fi
            fi
            python3 "$virtualenv_pyz" .venv
          fi

          .venv/bin/python -m pip install --upgrade pip
          .venv/bin/pip install -r requirements.txt
        '''
      }
    }

    stage('Test') {
      parallel {
        stage('Python Unit Tests') {
          steps {
            sh '''
              set -eu
              export PATH="${LOCAL_NODE_BIN}:$PATH"
              npm run test:python
            '''
          }
        }

        stage('WhatsApp Worker Syntax') {
          steps {
            sh '''
              set -eu
              export PATH="${LOCAL_NODE_BIN}:$PATH"
              npm run test:whatsapp-web
            '''
          }
        }
      }
    }

    stage('Deploy App Services') {
      when {
        expression {
          def branchName = env.BRANCH_NAME ?: ''
          return branchName.equalsIgnoreCase(env.DEV_BRANCH) ||
            branchName.equalsIgnoreCase(env.PROD_BRANCH) ||
            branchName.equalsIgnoreCase('master')
        }
      }
      steps {
        script {
          def branchName = env.BRANCH_NAME ?: ''
          def isProd = branchName.equalsIgnoreCase(env.PROD_BRANCH) || branchName.equalsIgnoreCase('master')
          def deployHost = isProd ? env.PROD_DEPLOY_HOST : env.DEV_DEPLOY_HOST
          def deployUser = isProd ? env.PROD_DEPLOY_USER : env.DEV_DEPLOY_USER
          def appDir = isProd ? env.PROD_APP_DIR : env.DEV_APP_DIR
          def apiService = isProd ? env.PROD_API_SERVICE : env.DEV_API_SERVICE
          def whatsappService = isProd ? env.PROD_WHATSAPP_SERVICE : env.DEV_WHATSAPP_SERVICE
          def sshCredential = isProd ? env.PROD_SSH_CREDENTIALS : env.DEV_SSH_CREDENTIALS
          def envCredential = isProd ? env.PROD_ENV_CREDENTIALS : env.DEV_ENV_CREDENTIALS

          withEnv([
            "DEPLOY_USER=${deployUser}",
            "DEPLOY_HOST=${deployHost}",
            "APP_DIR=${appDir}",
            "API_SERVICE=${apiService}",
            "WHATSAPP_SERVICE=${whatsappService}",
          ]) {
            sshagent(credentials: [sshCredential]) {
              withCredentials([file(credentialsId: envCredential, variable: 'DEPLOY_ENV_FILE')]) {
                sh(script: '''#!/usr/bin/env bash
                set -euo pipefail

                ssh_opts=(-o StrictHostKeyChecking=no)
                remote="${DEPLOY_USER}@${DEPLOY_HOST}"

                echo "Deploying OCRID app to ${remote}:${APP_DIR}"
                ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$APP_DIR'"
                rsync -az --delete \
                  --exclude .git \
                  --exclude .env \
                  --exclude .venv \
                  --exclude .runtime \
                  --exclude .jenkins \
                  --exclude node_modules \
                  --exclude logs \
                  --exclude reports \
                  --exclude .wwebjs_auth \
                  --exclude .wwebjs_cache \
                  ./ "$remote:$APP_DIR/"

                env_remote_tmp="${APP_DIR}/.env.jenkins.$$"
                scp "${ssh_opts[@]}" "$DEPLOY_ENV_FILE" "$remote:$env_remote_tmp"
                ssh "${ssh_opts[@]}" "$remote" "mv '$env_remote_tmp' '$APP_DIR/.env' && chmod 600 '$APP_DIR/.env'"

                ssh "${ssh_opts[@]}" "$remote" \
                  "APP_DIR='$APP_DIR' NODE_VERSION='$NODE_VERSION' API_SERVICE='$API_SERVICE' WHATSAPP_SERVICE='$WHATSAPP_SERVICE' DEPLOY_USER='$DEPLOY_USER' /bin/bash -s" <<'EOF'
set -euo pipefail

sudo_run() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    if ! output="$(sudo -n "$@" 2>&1)"; then
      status=$?
      printf '%s\n' "$output"
      echo "Remote user '$(id -un)' cannot run this command with passwordless sudo: $*"
      echo "Use command -v on the target server and allow those exact paths in sudoers."
      return "$status"
    fi
    printf '%s\n' "$output"
  fi
}

require_cmd() {
  command -v "$1" || {
    echo "$1 is not installed on the target server."
    exit 1
  }
}

INSTALL_BIN="$(require_cmd install)"
SYSTEMCTL_BIN="$(require_cmd systemctl)"

if ! command -v tesseract >/dev/null 2>&1; then
  APT_GET_BIN="$(require_cmd apt-get)"
  echo "Installing Tesseract OCR on the target server."
  sudo_run "$APT_GET_BIN" update
  sudo_run "$APT_GET_BIN" install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind
fi

if ! command -v tesseract >/dev/null 2>&1; then
  echo "Tesseract installation completed, but the tesseract executable is still not available in PATH."
  exit 1
fi

tesseract --version | head -n 1

cd "$APP_DIR"
mkdir -p logs .runtime .wwebjs_auth .wwebjs_cache

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; then
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(command -v npm)"
else
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *)
      echo "Unsupported target architecture for bundled Node: $arch"
      exit 1
      ;;
  esac

  node_parent="$APP_DIR/.runtime"
  node_dir="$node_parent/node-v${NODE_VERSION}-linux-${node_arch}"
  node_link="$node_parent/node"
  tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"

  if [ ! -x "$node_dir/bin/node" ]; then
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' EXIT
    mkdir -p "$node_parent"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$tmp_dir/$tarball"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$url" -O "$tmp_dir/$tarball"
    else
      echo "curl or wget is required to bootstrap Node on the target server."
      exit 1
    fi
    tar -xJf "$tmp_dir/$tarball" -C "$node_parent"
  fi

  ln -sfn "$node_dir" "$node_link"
  NODE_BIN="$node_link/bin/node"
  NPM_BIN="$node_link/bin/npm"
fi

NODE_BIN_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_BIN_DIR:$PATH"
"$NPM_BIN" ci --omit=dev

rm -rf .venv
if python3 -m venv .venv; then
  echo "Created target Python virtual environment with python3 -m venv."
else
  echo "python3 venv support is unavailable on target; bootstrapping virtualenv."
  rm -rf .venv
  virtualenv_pyz=".runtime/virtualenv.pyz"
  if [ ! -s "$virtualenv_pyz" ]; then
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL https://bootstrap.pypa.io/virtualenv.pyz -o "$virtualenv_pyz"
    elif command -v wget >/dev/null 2>&1; then
      wget -q https://bootstrap.pypa.io/virtualenv.pyz -O "$virtualenv_pyz"
    else
      echo "curl or wget is required to bootstrap virtualenv on the target server."
      exit 1
    fi
  fi
  python3 "$virtualenv_pyz" .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

api_unit="$(mktemp)"
whatsapp_unit="$(mktemp)"
trap 'rm -f "$api_unit" "$whatsapp_unit"' EXIT

cat > "$api_unit" <<UNIT
[Unit]
Description=OCRID API (${API_SERVICE})
After=network.target

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
Environment=PORT=6017
Environment=PYTHONUNBUFFERED=1
ExecStart=${APP_DIR}/.venv/bin/python ${APP_DIR}/main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > "$whatsapp_unit" <<UNIT
[Unit]
Description=OCRID WhatsApp Worker (${WHATSAPP_SERVICE})
After=network.target ${API_SERVICE}.service

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
Environment=WHATSAPP_WEB_HOST=127.0.0.1
Environment=WHATSAPP_WEB_PORT=3001
Environment=WHATSAPP_WEB_SESSION_PATH=${APP_DIR}/.wwebjs_auth
Environment=OCR_API_URL=http://127.0.0.1:6017
ExecStart=${NODE_BIN} ${APP_DIR}/whatsapp-web-worker.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo_run "$INSTALL_BIN" -m 0644 "$api_unit" "/etc/systemd/system/${API_SERVICE}.service"
sudo_run "$INSTALL_BIN" -m 0644 "$whatsapp_unit" "/etc/systemd/system/${WHATSAPP_SERVICE}.service"
sudo_run "$SYSTEMCTL_BIN" daemon-reload
sudo_run "$SYSTEMCTL_BIN" enable "$API_SERVICE.service" "$WHATSAPP_SERVICE.service"
sudo_run "$SYSTEMCTL_BIN" restart "$API_SERVICE.service"
sudo_run "$SYSTEMCTL_BIN" restart "$WHATSAPP_SERVICE.service"

wait_for_active() {
  label="$1"
  service="$2"
  attempt=1

  while [ "$attempt" -le 30 ]; do
    if sudo_run "$SYSTEMCTL_BIN" is-active --quiet "$service" >/dev/null 2>&1; then
      printf '%s systemd service is active.\n' "$label"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  printf '%s systemd service did not become active.\n' "$label"
  sudo_run "$SYSTEMCTL_BIN" status "$service" --no-pager || true
  return 1
}

fetch_url() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$url"
  else
    python3 - "$url" <<'PY'
import sys
import urllib.request

with urllib.request.urlopen(sys.argv[1], timeout=10) as response:
    print(response.read().decode())
PY
  fi
}

wait_for_health() {
  label="$1"
  url="$2"
  service="$3"
  attempt=1
  output=""

  while [ "$attempt" -le 30 ]; do
    if output="$(fetch_url "$url" 2>&1)"; then
      printf '%s health ready: %s\n' "$label" "$output"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  printf '%s did not become healthy at %s.\n' "$label" "$url"
  printf 'Last health check output:\n%s\n' "$output"
  sudo_run "$SYSTEMCTL_BIN" status "$service" --no-pager || true
  return 1
}

wait_for_active "OCR API" "$API_SERVICE.service"
wait_for_active "WhatsApp worker" "$WHATSAPP_SERVICE.service"
wait_for_health "OCR API" "http://127.0.0.1:6017/health" "$API_SERVICE.service"
wait_for_health "WhatsApp worker" "http://127.0.0.1:3001/health" "$WHATSAPP_SERVICE.service"
EOF
                ''')
              }
            }
          }
        }
      }
    }

    stage('Configure Nginx') {
      when {
        expression {
          def branchName = env.BRANCH_NAME ?: ''
          return branchName.equalsIgnoreCase(env.DEV_BRANCH) ||
            branchName.equalsIgnoreCase(env.PROD_BRANCH) ||
            branchName.equalsIgnoreCase('master')
        }
      }
      steps {
        script {
          def branchName = env.BRANCH_NAME ?: ''
          def isProd = branchName.equalsIgnoreCase(env.PROD_BRANCH) || branchName.equalsIgnoreCase('master')
          def deployHost = isProd ? env.PROD_DEPLOY_HOST : env.DEV_DEPLOY_HOST
          def deployUser = isProd ? env.PROD_DEPLOY_USER : env.DEV_DEPLOY_USER
          def nginxServerName = isProd ? env.PROD_NGINX_SERVER_NAME : env.DEV_NGINX_SERVER_NAME
          def sshCredential = isProd ? env.PROD_SSH_CREDENTIALS : env.DEV_SSH_CREDENTIALS

          withEnv([
            "DEPLOY_USER=${deployUser}",
            "DEPLOY_HOST=${deployHost}",
            "NGINX_SERVER_NAME=${nginxServerName}",
          ]) {
            sshagent(credentials: [sshCredential]) {
              sh(script: '''#!/usr/bin/env bash
                set -euo pipefail

                site_available="/etc/nginx/sites-available/${NGINX_SERVER_NAME}"
                site_enabled="/etc/nginx/sites-enabled/${NGINX_SERVER_NAME}"
                tmp_file="$(mktemp)"
                trap 'rm -f "$tmp_file"' EXIT

                echo "Configuring Nginx for branch '${BRANCH_NAME:-unknown}' at ${NGINX_SERVER_NAME} on ${DEPLOY_HOST}"

                cat > "$tmp_file" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name __NGINX_SERVER_NAME__;

    client_max_body_size 25m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location /whatsapp/ {
        proxy_pass __WHATSAPP_UPSTREAM__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass __OCR_API_UPSTREAM__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

                python3 - "$tmp_file" "$NGINX_SERVER_NAME" "$WHATSAPP_UPSTREAM" "$OCR_API_UPSTREAM" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
replacements = {
    "__NGINX_SERVER_NAME__": sys.argv[2],
    "__WHATSAPP_UPSTREAM__": sys.argv[3],
    "__OCR_API_UPSTREAM__": sys.argv[4],
}
text = path.read_text()
for needle, value in replacements.items():
    text = text.replace(needle, value)
path.write_text(text)
PY

                ssh_opts=(-o StrictHostKeyChecking=no)
                remote="${DEPLOY_USER}@${DEPLOY_HOST}"
                remote_tmp="$(ssh "${ssh_opts[@]}" "$remote" 'mktemp')"

                scp "${ssh_opts[@]}" "$tmp_file" "$remote:$remote_tmp"

                ssh "${ssh_opts[@]}" "$remote" \
                  "SITE_AVAILABLE='$site_available' SITE_ENABLED='$site_enabled' REMOTE_TMP='$remote_tmp' /bin/bash -s" <<'EOF'
set -euo pipefail

sudo_run() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    if ! output="$(sudo -n "$@" 2>&1)"; then
      status=$?
      printf '%s\n' "$output"
      echo "Remote user '$(id -un)' cannot run this command with passwordless sudo: $*"
      echo "Use command -v on the target server and allow those exact paths in sudoers."
      return "$status"
    fi
    printf '%s\n' "$output"
  fi
}

require_cmd() {
  command -v "$1" || {
    echo "$1 is not installed on the target server."
    exit 1
  }
}

INSTALL_BIN="$(require_cmd install)"
LN_BIN="$(require_cmd ln)"
NGINX_BIN="$(require_cmd nginx)"
SYSTEMCTL_BIN="$(command -v systemctl || true)"
SERVICE_BIN="$(command -v service || true)"

trap 'rm -f "$REMOTE_TMP"' EXIT

sudo_run "$INSTALL_BIN" -d /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo_run "$INSTALL_BIN" -m 0644 "$REMOTE_TMP" "$SITE_AVAILABLE"
sudo_run "$LN_BIN" -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
sudo_run "$NGINX_BIN" -t

if [ -n "$SYSTEMCTL_BIN" ]; then
  sudo_run "$SYSTEMCTL_BIN" reload nginx
elif [ -n "$SERVICE_BIN" ]; then
  sudo_run "$SERVICE_BIN" nginx reload
else
  sudo_run "$NGINX_BIN" -s reload
fi
EOF
              ''')
            }
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
    }
  }
}
