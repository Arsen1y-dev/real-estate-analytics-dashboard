#!/usr/bin/env bash
# Первичная настройка на Ubuntu VPS (Beget и аналоги).
# Запуск на сервере из корня репозитория:
#   sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_SITE="${NGINX_SITE:-real-estate-dashboard}"

if [[ "$(id -u)" -ne 0 ]]; then
    echo "Запустите с sudo: sudo bash deploy/setup.sh"
    exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
    echo "Не найден package.json в $APP_DIR"
    exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
    echo "Создайте $APP_DIR/.env из deploy/env.production.example и заполните ключи."
    exit 1
fi

echo "[deploy] Node.js..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]")" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "[deploy] nginx + build tools (better-sqlite3)..."
apt-get install -y nginx build-essential python3

echo "[deploy] npm install + build..."
cd "$APP_DIR"
sudo -u "${SUDO_USER:-root}" npm install
# shellcheck disable=SC1091
set -a && source "$APP_DIR/.env" && set +a
sudo -u "${SUDO_USER:-root}" npm run build

echo "[deploy] nginx site..."
sed "s|YOUR_DOMAIN_OR_IP|${SERVER_NAME}|g; s|/var/www/real-estate-analytics-dashboard|${APP_DIR}|g" \
    "$APP_DIR/deploy/nginx-dashboard.conf" > "/etc/nginx/sites-available/${NGINX_SITE}"
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "[deploy] systemd..."
sed "s|/var/www/real-estate-analytics-dashboard|${APP_DIR}|g" \
    "$APP_DIR/deploy/real-estate-dashboard.service" > "/etc/systemd/system/${NGINX_SITE}.service"
systemctl daemon-reload
systemctl enable "${NGINX_SITE}.service"
systemctl restart "${NGINX_SITE}.service"

echo ""
echo "Готово."
echo "  Сайт:  http://${SERVER_NAME}/"
echo "  API:   http://${SERVER_NAME}/api/health"
echo "  Логи:  journalctl -u ${NGINX_SITE}.service -f"
echo ""
echo "Referer для Яндекс.Карт: http://${SERVER_NAME}/*"
echo "Смените пароли тестовых пользователей (admin123 и т.д.) после первого входа."
