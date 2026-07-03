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

    stage('Configure Nginx') {
      steps {
        withCredentials([string(credentialsId: 'ocrid-sudo-password', variable: 'SUDO_PASSWORD')]) {
          sh '''
            set -eu

            if ! command -v nginx >/dev/null 2>&1; then
              echo "nginx is not installed on this Jenkins agent."
              exit 1
            fi

            sudo_run() {
              if [ "$(id -u)" -eq 0 ]; then
                "$@"
                return
              fi

              if [ -z "${SUDO_PASSWORD:-}" ]; then
                echo "Jenkins credential 'ocrid-sudo-password' is empty or unavailable."
                exit 1
              fi

              printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@"
            }

            branch_name="${BRANCH_NAME:-}"
            if [ "$branch_name" = "main" ] || [ "$branch_name" = "master" ]; then
              nginx_server_name="${PROD_NGINX_SERVER_NAME}"
            else
              nginx_server_name="${DEV_NGINX_SERVER_NAME}"
            fi

            site_available="/etc/nginx/sites-available/${nginx_server_name}"
            site_enabled="/etc/nginx/sites-enabled/${nginx_server_name}"
            tmp_file="$(mktemp)"
            trap 'rm -f "$tmp_file"' EXIT

            echo "Configuring Nginx for branch '${branch_name:-unknown}' at ${nginx_server_name}"

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

            python3 - "$tmp_file" "$nginx_server_name" "$WHATSAPP_UPSTREAM" "$OCR_API_UPSTREAM" <<'PY'
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

            sudo_run install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
            sudo_run install -m 0644 "$tmp_file" "$site_available"
            sudo_run ln -sfn "$site_available" "$site_enabled"
            sudo_run nginx -t

            if command -v systemctl >/dev/null 2>&1; then
              sudo_run systemctl reload nginx
            elif command -v service >/dev/null 2>&1; then
              sudo_run service nginx reload
            else
              sudo_run nginx -s reload
            fi
          '''
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
