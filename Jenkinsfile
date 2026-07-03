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
    DEPLOY_USER = 'deploy'
    DEV_BRANCH = 'DEV1'
    PROD_BRANCH = 'main'
    DEV_DEPLOY_HOST = 'devocrid.wong.systems'
    PROD_DEPLOY_HOST = 'ocrid.wong.systems'
    DEV_SSH_CREDENTIALS = 'ocrid-dev-ssh'
    PROD_SSH_CREDENTIALS = 'ocrid-prod-ssh'
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
          def nginxServerName = isProd ? env.PROD_NGINX_SERVER_NAME : env.DEV_NGINX_SERVER_NAME
          def sshCredential = isProd ? env.PROD_SSH_CREDENTIALS : env.DEV_SSH_CREDENTIALS

          withEnv([
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

sudo -n true

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed on the target server."
  exit 1
fi

sudo -n install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo -n install -m 0644 "$REMOTE_TMP" "$SITE_AVAILABLE"
sudo -n ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
sudo -n nginx -t

if command -v systemctl >/dev/null 2>&1; then
  sudo -n systemctl reload nginx
elif command -v service >/dev/null 2>&1; then
  sudo -n service nginx reload
else
  sudo -n nginx -s reload
fi

rm -f "$REMOTE_TMP"
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
