# Деплой на VPS (Beget / Ubuntu 24.04)

Один сервер: **nginx** отдаёт `dist/`, **Express** слушает `127.0.0.1:3001`, SQLite и датасеты в `server/data/` (уже в Git).

## Что нужно на VPS

- Ubuntu 24.04, 2 GB RAM, 20+ GB диск
- Доступ **root** по SSH или **VNC** в панели Beget
- Ключи Яндекс.Карт и Geocoder API

## 1. Подключение

```bash
ssh root@ВАШ_IP
```

Пароль root — из письма Beget или сброс в карточке VPS (это **не** пароль от cp.beget.com).

## 2. Клонирование

```bash
apt update && apt install -y git
mkdir -p /var/www && cd /var/www
git clone https://github.com/ВАШ_ЛОГИН/real-estate-analytics-dashboard.git
cd real-estate-analytics-dashboard
```

## 3. Переменные окружения

```bash
cp deploy/env.production.example .env
nano .env
```

Обязательно:

- `JWT_SECRET` — длинная случайная строка
- `YANDEX_GEOCODER_API_KEY`
- `VITE_YANDEX_MAPS_API_KEY` — **до сборки** (`npm run build`)

`VITE_API_BASE_URL` не задавайте: nginx отдаёт фронт и `/api` с одного адреса.

## 4. Автоустановка

```bash
export SERVER_NAME=62.217.176.204   # или ваш домен
sudo -E bash deploy/setup.sh
```

Скрипт ставит Node 20, nginx, собирает фронт, поднимает systemd-сервис.

## 5. Проверка

```bash
curl -s http://127.0.0.1/api/health
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/
```

В браузере: `http://ВАШ_IP/` — вход `observer` / `observer123` (или admin).

## Яндекс.Карты

В [developer.tech.yandex.ru](https://developer.tech.yandex.ru/) → JavaScript API → Referer:

```
http://ВАШ_IP/*
```

## Обновление после git pull

```bash
cd /var/www/real-estate-analytics-dashboard
git pull
npm install
set -a && source .env && set +a && npm run build
sudo systemctl restart real-estate-dashboard
```

## Полезные команды

| Действие | Команда |
|----------|---------|
| Логи API | `journalctl -u real-estate-dashboard -f` |
| Перезапуск API | `systemctl restart real-estate-dashboard` |
| Проверка nginx | `nginx -t && systemctl reload nginx` |

## SSL (когда будет домен)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru
```

Обновите Referer в Яндексе на `https://ваш-домен.ru/*`.

## Ограничения

- **Парсер** (Python + Chrome) на 2 GB RAM не рекомендуется; дашборд и API работают.
- Тестовые пароли из README смените в production.
- Баланс Beget должен быть положительным, иначе VPS отключат.

## Ручная установка (без setup.sh)

См. файлы в `deploy/`:

- `nginx-dashboard.conf` — подставить IP/домен и путь
- `real-estate-dashboard.service` — systemd unit
