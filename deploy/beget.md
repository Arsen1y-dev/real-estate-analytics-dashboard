# Полная инструкция: деплой на VPS Beget

Дашборд на одном сервере: **nginx** отдаёт статику из `dist/`, **Node.js API** слушает `127.0.0.1:3001`, данные — SQLite и JSON в `server/data/` (уже в репозитории).

Пример IP из вашего VPS: `62.217.176.204`. Подставьте свой, если отличается.

---

## Часть 1. Панель Beget (до SSH)

### 1.1. Заказ и настройка VPS

1. Войдите в [cp.beget.com](https://cp.beget.com) (логин/пароль **от панели** — это не пароль root на сервере).
2. Раздел **Облако → VPS** (или **VPS/VDS**).
3. Убедитесь, что **баланс положительный** — при нуле VPS отключат.
4. Если VPS ещё нет — закажите тариф **от ~7 ₽/день** (2 CPU, 2 GB RAM, 30 GB — достаточно для дашборда).
5. При создании выберите:
   - **ОС:** чистая **Ubuntu 24.04** (не Bitrix, не n8n, не готовые панели).
   - **Регион:** любой доступный.
6. Дождитесь статуса «Работает» / «Active». Запишите **IP-адрес** (например `62.217.176.204`).

### 1.2. Пароль root для SSH

Пароль **root** приходит **отдельно** — в письме на email или в карточке VPS:

1. Откройте карточку VPS в панели.
2. Найдите **«Пароль root»**, **«Сбросить пароль»** или **«Доступ»**.
3. Если пароля нет — нажмите **Сброс пароля root**, сохраните новый пароль в менеджере паролей.

> Пароль от `cp.beget.com` ≠ пароль `root` на Ubuntu.

### 1.3. VNC (если SSH не пускает)

В карточке VPS есть **VNC-консоль** — браузерный терминал без SSH. Логин: `root`, пароль — из п. 1.2.

### 1.4. Файрвол (если сайт не открывается снаружи)

На Beget порты **80** и **443** обычно открыты по умолчанию. Если с сервера всё работает, а из браузера — нет:

1. В панели VPS проверьте **Firewall / Сеть / Security groups**.
2. Разрешите входящие **TCP 80** и **443** (и **22** для SSH).

---

## Часть 2. Ключи Яндекса (до деплоя)

Нужны **два** ключа в [developer.tech.yandex.ru](https://developer.tech.yandex.ru/):

| Ключ | Сервис | Зачем |
|------|--------|--------|
| JavaScript API | Карта на фронте | `VITE_YANDEX_MAPS_API_KEY` |
| HTTP Geocoder API | Обратное геокодирование на сервере | `YANDEX_GEOCODER_API_KEY` |

**Referer для карт** (обязательно после деплоя):

```
http://62.217.176.204/*
```

Когда появится домен с HTTPS — добавьте также:

```
https://ваш-домен.ru/*
```

---

## Часть 3. Подключение к серверу

С вашего компьютера (Mac/Linux):

```bash
ssh root@62.217.176.204
```

При первом входе подтвердите fingerprint (`yes`). Введите пароль root из п. 1.2.

Windows: **PuTTY** или `ssh` в PowerShell / Windows Terminal.

---

## Часть 4. Установка на сервере (копируйте по шагам)

### 4.1. Обновление системы и git

```bash
apt update && apt upgrade -y
apt install -y git curl nano
```

### 4.2. Клонирование репозитория

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/Arsen1y-dev/real-estate-analytics-dashboard.git
cd real-estate-analytics-dashboard
```

Если репозиторий **приватный** — понадобится Personal Access Token GitHub или SSH-ключ на VPS.

### 4.3. Файл `.env`

```bash
cp deploy/env.production.example .env
nano .env
```

Заполните минимум так (подставьте свои ключи и секрет):

```env
NODE_ENV=production
JWT_SECRET=длинная-случайная-строка-минимум-32-символа
API_PORT=3001
API_HOST=127.0.0.1

YANDEX_GEOCODER_API_KEY=ваш-ключ-geocoder
VITE_YANDEX_MAPS_API_KEY=ваш-ключ-javascript-api
```

Сгенерировать `JWT_SECRET` на сервере:

```bash
openssl rand -base64 48
```

Сохранить в nano: `Ctrl+O`, Enter, `Ctrl+X`.

**Важно:** `VITE_*` переменные вшиваются в фронт **при сборке**. После смены ключа карт нужен `npm run build` заново.

`VITE_API_BASE_URL` **не задавайте** — nginx отдаёт и сайт, и `/api` с одного IP.

### 4.4. Автоустановка (nginx + Node + systemd)

```bash
export SERVER_NAME=62.217.176.204
sudo -E bash deploy/setup.sh
```

Скрипт:

- ставит **Node.js 20**;
- ставит **nginx**;
- выполняет `npm install` и `npm run build`;
- копирует конфиг nginx и systemd;
- запускает сервис `real-estate-dashboard`.

Установка займёт **5–15 минут** (скачивание npm-пакетов + сборка Vite).

### 4.5. Проверка на сервере

```bash
curl -s http://127.0.0.1/api/health
# ожидается JSON, например {"ok":true} или аналог

curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/
# ожидается HTTP 200

systemctl status real-estate-dashboard --no-pager
systemctl status nginx --no-pager
```

### 4.6. Проверка в браузере

Откройте: **http://62.217.176.204/**

Тестовые учётки (смените пароли после первого входа):

| Логин | Пароль | Роль |
|-------|--------|------|
| `observer` | `observer123` | Просмотр дашборда |
| `analyst` | `analyst123` | Аналитик + CSV |
| `admin` | `admin123` | Админ + парсер |

Если карта серая или ошибка API — проверьте Referer в Яндексе (часть 2).

---

## Часть 5. Если что-то пошло не так

### API не стартует

```bash
journalctl -u real-estate-dashboard -n 50 --no-pager
```

Частые причины: нет `.env`, ошибка в `npm install`, порт 3001 занят.

### Белая страница или 502

```bash
ls -la /var/www/real-estate-analytics-dashboard/dist/
nginx -t
journalctl -u nginx -n 30 --no-pager
```

Пересобрать фронт:

```bash
cd /var/www/real-estate-analytics-dashboard
set -a && source .env && set +a && npm run build
systemctl reload nginx
```

### Сайт не открывается с вашего ПК, но curl на сервере OK

- Проверьте файрвол в панели Beget (порт 80).
- Проверьте, что VPS включён и баланс > 0.

### Пересборка после смены ключей Яндекса

```bash
cd /var/www/real-estate-analytics-dashboard
nano .env   # обновите VITE_YANDEX_MAPS_API_KEY
set -a && source .env && set +a && npm run build
systemctl restart real-estate-dashboard
systemctl reload nginx
```

---

## Часть 6. Обновление после `git push`

```bash
cd /var/www/real-estate-analytics-dashboard
git pull
npm install
set -a && source .env && set +a && npm run build
systemctl restart real-estate-dashboard
systemctl reload nginx
```

---

## Часть 7. SSL и домен (когда привяжете домен к IP)

1. В DNS домена создайте **A-запись** `@` → `62.217.176.204` (и `www` при необходимости).
2. На сервере:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru
```

3. В nginx `server_name` замените IP на домен (или перезапустите `setup.sh` с `SERVER_NAME=ваш-домен.ru`).
4. В Яндекс.Картах добавьте Referer `https://ваш-домен.ru/*`.

---

## Часть 8. Полезные команды

| Действие | Команда |
|----------|---------|
| Логи API в реальном времени | `journalctl -u real-estate-dashboard -f` |
| Перезапуск API | `systemctl restart real-estate-dashboard` |
| Статус API | `systemctl status real-estate-dashboard` |
| Проверка nginx | `nginx -t` |
| Перезагрузка nginx | `systemctl reload nginx` |
| Место на диске | `df -h` |
| RAM | `free -h` |

---

## Часть 9. Ограничения на тарифе 2 GB

| Компонент | На VPS |
|-----------|--------|
| Дашборд + API + карта | ✅ Работает |
| Датасеты Москва/Саратов из Git | ✅ Уже в репозитории |
| Парсер (Python + Chrome) | ⚠️ Не рекомендуется — мало RAM, Chrome тяжёлый |
| Geocoding | ✅ Кэш в SQLite + ключ Яндекса + fallback |

Парсер лучше запускать **локально на ноутбуке**, затем заливать CSV через admin или `git push` датасета.

---

## Часть 10. Безопасность после деплоя

1. Смените пароли `admin`, `analyst`, `observer` (вход admin → пользователи или через API).
2. Не публикуйте `.env` и пароли root в чатах и Git.
3. `JWT_SECRET` — уникальный, длинный.
4. API слушает только `127.0.0.1` — снаружи доступен только через nginx.

---

## Ручная установка (без `setup.sh`)

Файлы в `deploy/`:

- `nginx-dashboard.conf` — подставить `server_name` и путь к `dist/`
- `real-estate-dashboard.service` — unit для systemd
- `env.production.example` — шаблон `.env`

```bash
# nginx
cp deploy/nginx-dashboard.conf /etc/nginx/sites-available/real-estate-dashboard
# отредактировать server_name и root
ln -s /etc/nginx/sites-available/real-estate-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# systemd
cp deploy/real-estate-dashboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now real-estate-dashboard
```
