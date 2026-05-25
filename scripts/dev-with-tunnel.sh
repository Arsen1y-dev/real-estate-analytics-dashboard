#!/usr/bin/env bash
# API + фронт + публичный HTTPS-туннель в интернет.
# По умолчанию: production-сборка + vite preview (стабильно через localtunnel).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEV_PORT="${DEV_PORT:-3000}"
TUNNEL_PROVIDER="${TUNNEL_PROVIDER:-localtunnel}"
TUNNEL_SERVE="${TUNNEL_SERVE:-preview}"
TUNNEL_RECONNECT_SEC="${TUNNEL_RECONNECT_SEC:-5}"
API_PID=""
VITE_PID=""
SHUTDOWN=0

cleanup() {
    SHUTDOWN=1
    if [[ -n "$VITE_PID" ]]; then
        kill "$VITE_PID" 2>/dev/null || true
    fi
    if [[ -n "$API_PID" ]]; then
        kill "$API_PID" 2>/dev/null || true
    fi
}

trap cleanup INT TERM

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Не найдена команда: $1"
        echo "$2"
        exit 1
    fi
}

wait_for_http() {
    local url="$1"
    local attempts="${2:-120}"
    for ((i = 1; i <= attempts; i++)); do
        if curl -sf "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    echo "Не дождались ответа от $url"
    exit 1
}

free_listen_port() {
    local port="$1"
    local pids
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
        return 0
    fi
    echo "[tunnel] Порт ${port} занят (PID: ${pids//$'\n'/, }) — освобождаем..."
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.6
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
        echo "[tunnel] Не удалось освободить порт ${port}. Остановите dev:all / старый туннель или задайте DEV_PORT=3004"
        exit 1
    fi
}

wait_for_vite_process() {
    local pid="$1"
    sleep 0.4
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    echo "[tunnel] Vite не запустился (порт ${DEV_PORT}?). См. ошибку выше."
    exit 1
}

ensure_backend_alive() {
    if [[ -n "$API_PID" ]] && ! kill -0 "$API_PID" 2>/dev/null; then
        echo "[tunnel] API упал — перезапуск..."
        npm run dev:api &
        API_PID=$!
    fi
    if [[ -n "$VITE_PID" ]] && ! kill -0 "$VITE_PID" 2>/dev/null; then
        echo "[tunnel] Vite упал — перезапуск preview..."
        npx vite preview --port "$DEV_PORT" --strictPort &
        VITE_PID=$!
        wait_for_vite_process "$VITE_PID"
        wait_for_http "http://127.0.0.1:${DEV_PORT}/"
    fi
}

run_localtunnel() {
    local -a lt_args=(--port "$DEV_PORT" --local-host 127.0.0.1)
    if [[ -n "${LT_SUBDOMAIN:-}" ]]; then
        lt_args+=(--subdomain "$LT_SUBDOMAIN")
    fi
    if [[ -x "$ROOT/node_modules/.bin/lt" ]]; then
        "$ROOT/node_modules/.bin/lt" "${lt_args[@]}"
    else
        npx --yes localtunnel "${lt_args[@]}"
    fi
}

run_tunnel_forever() {
    local target="http://127.0.0.1:${DEV_PORT}"
    while [[ "$SHUTDOWN" -eq 0 ]]; do
        ensure_backend_alive
        local exit_code=0
        case "$TUNNEL_PROVIDER" in
            cloudflare)
                echo "[tunnel] Cloudflare Quick Tunnel → $target"
                cloudflared tunnel \
                    --protocol "${CLOUDFLARE_PROTOCOL:-http2}" \
                    --ha-connections "${CLOUDFLARE_HA_CONNECTIONS:-2}" \
                    --url "$target" || exit_code=$?
                ;;
            localtunnel)
                echo "[tunnel] localtunnel → порт $DEV_PORT (Ctrl+C для остановки)"
                run_localtunnel || exit_code=$?
                ;;
            ngrok)
                echo "[tunnel] ngrok → $target"
                ngrok http "$DEV_PORT" || exit_code=$?
                ;;
        esac
        if [[ "$SHUTDOWN" -eq 1 ]]; then
            break
        fi
        echo ""
        echo "[tunnel] Туннель оборвался (код ${exit_code}). API и сайт на localhost:${DEV_PORT} ещё работают."
        echo "[tunnel] Новый URL появится через ${TUNNEL_RECONNECT_SEC} с... (Ctrl+C — полная остановка)"
        sleep "$TUNNEL_RECONNECT_SEC"
    done
}

case "$TUNNEL_PROVIDER" in
    cloudflare|cf)
        TUNNEL_PROVIDER=cloudflare
        require_cmd cloudflared "Установка: brew install cloudflared"
        ;;
    ngrok)
        require_cmd ngrok "Установка: brew install ngrok"
        ;;
    localtunnel|lt)
        TUNNEL_PROVIDER=localtunnel
        ;;
    *)
        echo "Неизвестный TUNNEL_PROVIDER: $TUNNEL_PROVIDER (localtunnel | cloudflare | ngrok)"
        exit 1
        ;;
esac

require_cmd curl "curl нужен для проверки готовности Vite"

API_PORT="${API_PORT:-3001}"
free_listen_port "$DEV_PORT"
free_listen_port "$API_PORT"

echo "[tunnel] Запуск API (порт ${API_PORT})..."
npm run dev:api &
API_PID=$!

if [[ "$TUNNEL_SERVE" == "preview" ]]; then
    echo "[tunnel] Сборка фронтенда (npm run build)..."
    npm run build
    echo "[tunnel] Запуск vite preview на порту ${DEV_PORT}..."
    npx vite preview --port "$DEV_PORT" --strictPort &
else
    echo "[tunnel] Режим vite dev (через туннель не рекомендуется)..."
    npx vite --port "$DEV_PORT" --strictPort &
fi
VITE_PID=$!
wait_for_vite_process "$VITE_PID"

wait_for_http "http://127.0.0.1:${DEV_PORT}/"
echo "[tunnel] Фронт готов (режим: $TUNNEL_SERVE)"

echo ""
echo "=== Публичный доступ в интернет ==="
echo "• Дождитесь «your url is: https://...» — этот URL меняется при каждом переподключении"
echo "• localtunnel: первый заход — «Click to Continue»"
echo "• Referer Яндекс.Карт: https://ВАШ-ДОМЕН/*"
echo "• Ноутбук должен быть включён; сон Wi‑Fi обрывает туннель (скрипт переподключит сам)"
echo ""

run_tunnel_forever
cleanup
