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
    NGINX_SITE_NAME = 'ocrid.wong.systems'
    NGINX_SERVER_NAME = 'ocrid.wong.systems'
    OCR_API_UPSTREAM = 'http://127.0.0.1:6017'
    WHATSAPP_UPSTREAM = 'http://127.0.0.1:3001'
  }

  stages {
    stage('Tooling') {
      steps {
        sh '''
          set -eu
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
        sh 'npm ci'
      }
    }

    stage('Install Python') {
      steps {
        sh '''
          set -eu
          rm -rf .venv
          python3 -m venv .venv
          .venv/bin/python -m pip install --upgrade pip
          .venv/bin/pip install -r requirements.txt
        '''
      }
    }

    stage('Test') {
      parallel {
        stage('Python Unit Tests') {
          steps {
            sh 'npm run test:python'
          }
        }

        stage('WhatsApp Worker Syntax') {
          steps {
            sh 'npm run test:whatsapp-web'
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

            site_available="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
            site_enabled="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
            tmp_file="$(mktemp)"
            trap 'rm -f "$tmp_file"' EXIT

            cat > "$tmp_file" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${NGINX_SERVER_NAME};

    client_max_body_size 25m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location /whatsapp/ {
        proxy_pass ${WHATSAPP_UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass ${OCR_API_UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

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
