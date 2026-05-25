# Real Estate Analytics Dashboard

Интерактивный дашборд для анализа объявлений о продаже квартир: фильтры, KPI, графики, карта, таблица результатов. Данные — с сервера (по городам) или из личного CSV. Для администратора встроен парсер Яндекс.Недвижимость и загрузка датасетов.

## Стек

### Frontend

| Технология | Версия |
|------------|--------|
| React | 19.2 |
| TypeScript | ~5.8 |
| Vite | 6.2 |
| Recharts | 3.4 |
| Tailwind CSS | CDN в dev (`index.html`) |
| PapaParse | 5.5 — разбор CSV |
| SheetJS (xlsx) | 0.18 — экспорт |
| html2canvas + jsPDF | экспорт в PDF |
| Яндекс.Карты JS API | 2.1 |

Шрифты: Onest, Lora (Google Fonts).

### Backend

| Технология | Версия |
|------------|--------|
| Node.js + tsx | runtime |
| Express | 5.2 |
| better-sqlite3 | 12.10 — пользователи, кэш геокодера |
| bcryptjs | 3.0 — пароли |
| jsonwebtoken | 9.0 — JWT |
| multer | 2.1 — загрузка CSV |
| cors, dotenv | |

API по умолчанию на порту **3001**, Vite dev-сервер на **3000** с proxy `/api` → `3001`.

### Парсер

Python 3 + Selenium 4, pandas 2. Подробности — в секции [«Парсер»](#парсер) ниже.

### Общий код

Каталог `shared/` — типы дашборда, фильтры, города, ключи геокодера, прогресс парсера. Импортируется и в `server/`, и в `src/`.

## Быстрый старт

```bash
npm install
cp .env.example .env
# при необходимости — ключи карт и геокодера
npm run dev:all
```

Открыть http://localhost:3000. API: http://localhost:3001/api/health.

Если заходите с телефона по IP в локальной сети — **не** задавайте `VITE_API_BASE_URL`: запросы пойдут через proxy Vite на `/api`.

Тестовые учётки создаются при первом запуске API:

| Логин | Пароль | Роль |
|-------|--------|------|
| `observer` | `observer123` | Наблюдатель |
| `analyst` | `analyst123` | Аналитик |
| `admin` | `admin123` | Администратор |
| `manager` | `manager123` | Руководитель |

## Города

| Город | ID | Данные на сервере | Конфиг парсера |
|-------|-----|-------------------|----------------|
| Москва | `moscow` | `server/data/cities/moscow/` | `parser/configs/config.moscow.json` |
| Саратов | `saratov` | `server/data/cities/saratov/` | `parser/configs/config.saratov.json` |

Центр карты и лимит фильтра «Расстояние до центра»: Москва — 120 км, Саратов — 100 км (`shared/cities.ts`).

## Роли

### observer — наблюдатель

Только серверный датасет выбранного города. Блок «Обзор рынка» (медианы цены, площади, число объектов, автоинсайты), фильтры, графики, карта, пресеты. Без CSV, таблицы объявлений и экспорта.

### analyst — аналитик

Всё у observer плюс переключатель «Сервер / Свой CSV», таблица результатов, экспорт, конструктор графиков, обновление с сервера.

### admin — администратор

Сразу серверные данные (без выбора CSV). Панели управления серверным датасетом и парсером. Блок «Обзор рынка» скрыт. При пустом городе — экран первичной настройки (загрузка, парсер, смена города).

### manager — руководитель

Отдельная консоль, не дашборд. Вкладки «Рынки» (сводка по всем городам: строки, дата обновления, диапазон цен) и «Пользователи» (создание, смена роли, сброс пароля, удаление). Может назначать роли observer / analyst / admin.

## Возможности дашборда

**Фильтры** — цена, площадь, комнаты, год постройки, расстояние до центра, тип дома, этаж (исключить первый/последний), планировки. Диапазоны задаются полями «От» / «До». Блок **«Дополнительные фильтры»** — условия по любой колонке: для чисел — ≥, ≤, между; для one-hot и бинарных признаков (`санузел_*`, `тип_дома_*`, `*_есть` и т.п.) — выбор «Да / Нет»; для текстовых категорий — выпадающий список значений из данных (если их немного) или ручной ввод.

**Обзор рынка** — медиана цены, цены за м², площадей, число объектов в выборке; автоинсайты по текущим фильтрам.

**Графики** — гистограммы, категориальные bar chart, scatter с линией тренда (МНК). Конструктор: выбор осей из подходящих колонок. Полноэкранный режим карточки.

**Сравнение сегментов** — два набора фильтров рядом.

**Карта** — Yandex Maps, кластеризация, балуны с ценой и ссылкой на объявление, полноэкранный режим, лимит числа точек.

**Таблица** — настраиваемые колонки, сортировка, ссылка на объявление. Reverse geocoding для строк без адреса, но с координатами: панель «Запустить / Остановить геокодинг» и прогресс-бар; кэш в SQLite подхватывается при открытии. На карте адреса по координатам подставляются автоматически.

**Темы** — режим яркости: авто (системная), светлая, тёмная. Палитра: стандарт, Hello Kitty, зелёная. Доступны всем ролям, в том числе в консоли manager.

## Источники данных

| Режим | Где хранится | Кто |
|-------|--------------|-----|
| Сервер | `server/data/cities/{cityId}/dataset.json` + meta | observer, analyst, admin |
| Свой CSV | `localStorage` (`realty-dashboard-dataset-v2`) | analyst, admin |

При ingest и загрузке строки с одним offer id сливаются (`shared/mergeDatasetRows.ts`), чтобы координаты и ссылки из разных выгрузок попали в одну запись.

## Reverse geocoding

Для строк без нормального адреса, но с координатами, таблица может подтянуть текстовый адрес через API. Ложные адреса офиса Яндекса («Садовническая, 82») отбрасываются на этапе парсинга, ETL и в UI — вместо них используется geocoding.

Цепочка на сервере: Yandex Geocoder (с ключом) → Yandex без ключа → Nominatim (OpenStreetMap). Успешные ответы пишутся в SQLite (`reverse_geocode_cache`) и in-memory кэш с TTL (`REVERSE_GEOCODE_TTL_DAYS`, по умолчанию 14).

В **таблице** geocoding не стартует сам: кнопки «Запустить геокодинг» / «Остановить геокодинг» и прогресс «N / M». При открытии таблицы snapshot по ключам подтягивает уже сохранённые адреса из кэша. На **карте** geocoding для балунов идёт в фоне.

```env
YANDEX_GEOCODER_API_KEY=...
REVERSE_GEOCODE_TTL_DAYS=14
```

После правки `.env` перезапустите `npm run dev:all`.

## Парсер

Python-пайплайн в `parser/` для сбора объявлений с `realty.yandex.ru` и подготовки CSV под дашборд. Из UI (роль admin): сбор ссылок → карточек → подготовка CSV → загрузка на сервер. Прогресс в реальном времени (polling), поддержка капчи, лимит квартир.

Основной поток:

```text
links -> details -> flush (опционально) -> etl -> ingest в серверный dataset
```

**Назначение:**

- собрать ссылки объявлений по сегментам города;
- спарсить карточки (цена, площади, адрес, координаты, параметры дома и т.д.);
- нормализовать данные в формат дашборда (`processed_apartment_data.csv`);
- передать итоговый CSV в серверную часть (через API или админ-панель).

**Зависимости** (`parser/requirements-parser.txt`): `selenium>=4.20`, `webdriver-manager>=4.0`, `pandas>=2.0`, `dash>=2.16`, `plotly>=5.20`. В runtime в основном используются Selenium, webdriver-manager и pandas; `dash`/`plotly` остаются как вспомогательные.

**Структура каталога:**

```text
parser/
  configs/
    config.moscow.json
    config.saratov.json
    moscow_search_segments.json
    saratov_search_segments.json
  data/<city>/
    yandex_realty_links.txt
    yandex_realty_details.csv
    processed_apartment_data.csv
    parsing_stats.json
    details_parsing_stats.json
  pipeline/
    run_links.py
    run_details.py
    run_pipeline.py
    etl.py
    qa_report.py
    handoff_dashboard.py
    config.py
    runtime_status.py
    chrome_driver.py
    details_store.py
    .runtime_status.json
    .runtime_control.json
  yandex_realty_advanced_parser.py
  yandex_realty_details_parser.py
```

**Конфиги по городам** — `parser/configs/config.moscow.json`, `parser/configs/config.saratov.json`. Ключевые поля:

- `base_url` / `base_urls` / `search_segments_file` — где искать объявления;
- `links_file`, `details_file`, `processed_file` — куда писать артефакты;
- `runtime_status_file`, `runtime_control_file` — состояние прогресса и resume;
- `city_center_lat`, `city_center_lng` — центр города для ETL-расчётов;
- `resume_details`, `resume_after_captcha` — восстановление после прерываний/капчи;
- `request_delays_ms`, `min_delay_ms`, `max_delay_ms` — паузы anti-bot.

Проверка конфигов: `npm run check:parser-configs`.

**Подготовка окружения** (из корня проекта):

```bash
python3 -m venv parser/.venv
parser/.venv/bin/pip install -r parser/requirements-parser.txt
```

Из каталога `parser/`:

```bash
cd parser
.venv/bin/python -m pipeline.run_links --help
```

### Стадии pipeline

Команды ниже выполняются из `parser/`. Для другого города замените `config.moscow.json` на `config.saratov.json`.

**1) links — сбор ссылок**

```bash
.venv/bin/python -m pipeline.run_links --config configs/config.moscow.json
```

С лимитом:

```bash
.venv/bin/python -m pipeline.run_links --config configs/config.moscow.json --target-listings 500
```

**2) details — парсинг карточек**

```bash
.venv/bin/python -m pipeline.run_details --config configs/config.moscow.json
```

Полный перепарс:

```bash
.venv/bin/python -m pipeline.run_details --config configs/config.moscow.json --fresh
```

**3) flush — слияние временного буфера**

```bash
.venv/bin/python -m pipeline.run_details --config configs/config.moscow.json --flush-only
```

**4) etl — подготовка итоговой таблицы**

```bash
.venv/bin/python -m pipeline.etl --config configs/config.moscow.json
```

**5) полный pipeline**

```bash
.venv/bin/python -m pipeline.run_pipeline --config configs/config.moscow.json
```

Флаги `run_pipeline`: `--skip-links`, `--skip-details`, `--skip-etl`, `--skip-qa`, `--skip-handoff`, `--target-listings N`.

**6) QA-отчёт отдельно**

```bash
.venv/bin/python -m pipeline.qa_report --config configs/config.moscow.json
```

### Runtime status

- `pipeline/.runtime_status.json` — текущая стадия, статус, прогресс, `statusMessage`;
- `pipeline/.runtime_control.json` — resume-сигнал (`resume_requested_at`).

Их читает API (`server/parserJobs.ts`) для прогресса в админ-панели и обработки `resume`.

### Выгрузка результата в дашборд

**Через UI (рекомендуется):** войти как `admin`, в `AdminParserPanel` запустить стадии (`links`/`details`/`etl`/…), нажать «Загрузить итоговую таблицу на сервер».

**Через API:** после готовности `processed_file` — `POST /api/admin/dataset/ingest-pipeline` с телом `{ city, mode }`. Для регулярного обновления `mode=replace` обычно безопаснее `append`.

### Диагностика

**Captcha:** при детекции статус меняется на `captcha_required` / `waiting_user`; в headless-режиме Chrome может переключиться в режим с окном. Продолжение из UI/API: `POST /api/admin/parser/jobs/:id/resume`.

**Selenium / ChromeDriver:** ошибки `-9`/`SIGKILL` обычно связаны с драйвером или политикой macOS; подсказки в `pipeline/chrome_driver.py`.

**Python и окружение:** API-раннер умеет auto-bootstrap `parser/.venv`, если зависимости не найдены. Для фиксированного интерпретатора — `PARSER_PYTHON`.

**Ключи:** для стадий `links`/`details`/`etl` отдельные внешние API-ключи не нужны. `VITE_YANDEX_MAPS_API_KEY` и `YANDEX_GEOCODER_API_KEY` — для веб-приложения/API, не для парсера.

**Качество данных:** `etl` нормализует адреса, координаты, ссылки и вычисляет производные поля; `qa_report` проверяет схему и базовые метрики. На сервере дедупликация append-ингеста опирается на offer id; строки без id могут остаться отдельными.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `VITE_YANDEX_MAPS_API_KEY` | JavaScript API 2.1 Яндекс.Карт |
| `YANDEX_GEOCODER_API_KEY` | Geocoder API (reverse geocoding) |
| `REVERSE_GEOCODE_TTL_DAYS` | TTL кэша геокодера, дни (по умолчанию 14) |
| `VITE_API_BASE_URL` | Явный URL API; в dev обычно пусто |
| `JWT_SECRET` | Секрет JWT (в проде обязательно сменить) |
| `API_PORT` | Порт API (3001) |
| `PARSER_PYTHON` | Python для jobs парсера |
| `NODE_ENV` | `production` отключает debug-эндпоинты |

## API (кратко)

Авторизация: `Authorization: Bearer <token>`, кроме `POST /api/auth/login`.

**Общие:** `/api/health`, `/api/me`, `/api/dataset/cities`, `/api/dataset/meta`, `/api/dataset/bootstrap`, `/api/summary`, `/api/listings`, `/api/geocode/reverse`, `POST /api/geocode/progress`.

**Экспорт:** `GET /api/export.csv` — analyst, admin.

**Admin dataset:** export, upload CSV, `ingest-pipeline`, delete, delete batch.

**Admin parser:** cities, jobs CRUD, resume (капча).

**Manager:** `markets/overview`, users CRUD.

Полный список маршрутов — `server/index.ts`.

## localStorage

| Ключ | Содержимое |
|------|------------|
| `realty-dashboard-auth-v1` | JWT, пользователь |
| `realty-dashboard-city-v1` | Выбранный город |
| `realty-dashboard-source-v1` | server / personal |
| `realty-dashboard-dataset-v2` | Кэш личного CSV |
| `realty-dashboard-theme-mode-v1` | auto / light / dark |
| `realty-dashboard-scheme-v1` | standard / helloKitty / green |
| `realty-dashboard-map-point-limit-v1` | Лимит точек на карте |

## npm-скрипты

| Команда | Что делает |
|---------|------------|
| `npm run dev` | Vite :3000 |
| `npm run dev:api` | Express :3001 |
| `npm run dev:all` | Оба процесса |
| `npm run build` | Сборка в `dist/` |
| `npm run preview` | Просмотр production-сборки |
| `npm run check:parser-configs` | Валидация JSON конфигов парсера |

## Структура репозитория

```
server/                 Express API
  index.ts              маршруты
  datasetStore.ts       ingest, dedup, merge
  cityDatasetManager.ts датасеты по городам
  parserJobs.ts         очередь и прогресс парсера
  parserRunner.ts       spawn Python
  reverseGeocoder.ts    geocode + SQLite cache
  userAdmin.ts          CRUD пользователей
  managerMarkets.ts     сводка для manager
  data/
    app.db              SQLite
    cities/moscow|saratov/

src/                    React UI
  App.tsx               layout дашборда
  components/           фильтры, графики, карта, таблица, admin, manager
  domain/               фильтры, датасет, роли
  api/                  клиент API
  hooks/                тема и прочее

shared/                 общие типы и логика
parser/                 Python-пайплайн (см. секцию «Парсер»)
report/                 LaTeX-отчёт (отдельно от runtime)
```

## Сборка

```bash
npm run build
```

Статика в `dist/`. API поднимается отдельно (`npm run dev:api` или process manager). Для production задайте `JWT_SECRET`, ключи Яндекса, при необходимости `VITE_API_BASE_URL` на URL API.

## Лицензия

MIT — см. [LICENSE](LICENSE).
