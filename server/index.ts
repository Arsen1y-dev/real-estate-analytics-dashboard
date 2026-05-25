import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { bootstrapEnvStatus } from './bootstrapEnv';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { DataSummary, FilterSettings } from '../shared/dashboard';
import { rowPassesFiltersShared } from '../shared/filters';
import { isKnownCityId, getCityProfile } from '../shared/cities';
import type { UploadMode } from '../shared/datasetServer';
import { CityDatasetManager } from './cityDatasetManager';
import { ParserJobService } from './parserJobs';
import type { ParserStage } from './parserRunner';
import { processedCsvPath } from './parserRunner';
import type { Role } from './roles';
import { isRole } from './roles';
import { migrateUsersTableForManager, UserAdminService } from './userAdmin';
import { buildMarketsOverview } from './managerMarkets';
import { ReverseGeocoderService } from './reverseGeocoder';

type AuthUser = {
    id: number;
    username: string;
    role: Role;
};

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cors({ origin: true, credentials: true }));

const ROOT = process.cwd();
const SERVER_DATA_DIR = path.join(ROOT, 'server', 'data');
const DB_PATH = path.join(SERVER_DATA_DIR, 'app.db');
const DEFAULT_CSV_PATH = path.join(ROOT, 'processed_apartment_data.csv');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = Number(process.env.API_PORT || 3001);
const MAX_DATASET_BYTES = 20 * 1024 * 1024;
const MAX_DATASET_ROWS = 50_000;
const IS_DEV = process.env.NODE_ENV !== 'production';

fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('observer','analyst','admin','manager')),
  created_at TEXT NOT NULL
);
`);

migrateUsersTableForManager(db);
const userAdmin = new UserAdminService(db);

function ensureSeedUser(username: string, password: string, role: Role): void {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (existing) return;
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
        .run(username, hash, role, new Date().toISOString());
}

ensureSeedUser('admin', 'admin123', 'admin');
ensureSeedUser('analyst', 'analyst123', 'analyst');
ensureSeedUser('observer', 'observer123', 'observer');
ensureSeedUser('manager', 'manager123', 'manager');

const cityDatasets = new CityDatasetManager(SERVER_DATA_DIR, DEFAULT_CSV_PATH);
const parserJobs = new ParserJobService(db, SERVER_DATA_DIR);
const reverseGeocoder = new ReverseGeocoderService(db);

function enrichSummary(summary: DataSummary, cityId: string): DataSummary {
    const profile = getCityProfile(cityId);
    if (!profile) return summary;
    return {
        ...summary,
        cityId,
        cityCenter: { lat: profile.centerLat, lng: profile.centerLng },
    };
}

function parseCityParam(req: express.Request, res: express.Response): string | null {
    const city = String(req.query.city ?? (req.body as { city?: string })?.city ?? '').trim();
    if (!city || !isKnownCityId(city)) {
        res.status(400).json({ error: 'Укажите параметр city (moscow или saratov)' });
        return null;
    }
    return city;
}

function getStoreForCity(req: express.Request, res: express.Response) {
    const cityId = parseCityParam(req, res);
    if (!cityId) return null;
    const store = cityDatasets.getStore(cityId);
    if (!store) {
        res.status(400).json({ error: 'Неизвестный город' });
        return null;
    }
    return { cityId, store };
}

function createDefaultFilters(summary: DataSummary): FilterSettings {
    return {
        price: { ...summary.price },
        area: { ...summary.area },
        rooms: [],
        yearBuilt: { ...summary.yearBuilt },
        distanceKm: { ...summary.distanceKm },
        floor: { ...summary.floor },
        houseTypes: [],
        excludeFirstFloor: false,
        excludeLastFloor: false,
        radiusKm: null,
        additionalFilters: [],
    };
}

function parseFilters(query: Record<string, unknown>, summary: DataSummary): FilterSettings {
    const defaults = createDefaultFilters(summary);
    const asNum = (v: unknown, fallback: number) => {
        const n = Number.parseFloat(String(v ?? ''));
        return Number.isFinite(n) ? n : fallback;
    };
    const roomsRaw = String(query.rooms ?? '').split(',').map(v => Number.parseInt(v, 10)).filter(Number.isFinite);
    const houseTypes = String(query.houseTypes ?? '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .filter(v => summary.houseTypes.includes(v));
    const distanceMin = asNum(query.distanceKmMin, defaults.distanceKm.min);
    const distanceMax = asNum(query.distanceKmMax, defaults.distanceKm.max);
    let additionalFilters = defaults.additionalFilters;
    if (query.additionalFilters != null && query.additionalFilters !== '') {
        try {
            const parsed = JSON.parse(String(query.additionalFilters));
            if (Array.isArray(parsed)) {
                additionalFilters = parsed;
            }
        } catch {
            additionalFilters = defaults.additionalFilters;
        }
    }
    return {
        ...defaults,
        price: {
            min: asNum(query.priceMin, defaults.price.min),
            max: asNum(query.priceMax, defaults.price.max),
        },
        area: {
            min: asNum(query.areaMin, defaults.area.min),
            max: asNum(query.areaMax, defaults.area.max),
        },
        rooms: roomsRaw,
        yearBuilt: {
            min: asNum(query.yearBuiltMin, defaults.yearBuilt.min),
            max: asNum(query.yearBuiltMax, defaults.yearBuilt.max),
        },
        distanceKm: {
            min: Math.min(Math.max(distanceMin, defaults.distanceKm.min), defaults.distanceKm.max),
            max: Math.max(Math.min(distanceMax, defaults.distanceKm.max), defaults.distanceKm.min),
        },
        floor: {
            min: asNum(query.floorMin, defaults.floor.min),
            max: asNum(query.floorMax, defaults.floor.max),
        },
        houseTypes,
        excludeFirstFloor: String(query.excludeFirstFloor ?? '').toLowerCase() === 'true',
        excludeLastFloor: String(query.excludeLastFloor ?? '').toLowerCase() === 'true',
        radiusKm:
            query.radiusKm == null || query.radiusKm === ''
                ? null
                : asNum(query.radiusKm, defaults.distanceKm.max),
        additionalFilters,
    };
}

function signToken(user: AuthUser): string {
    return jwt.sign(user, JWT_SECRET, { expiresIn: '12h' });
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    try {
        const token = auth.slice(7);
        const user = jwt.verify(token, JWT_SECRET) as AuthUser;
        (req as express.Request & { user: AuthUser }).user = user;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

function requireRoles(roles: Role[]) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const user = (req as express.Request & { user?: AuthUser }).user;
        if (!user || !roles.includes(user.role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DATASET_BYTES },
});

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

if (IS_DEV) {
    app.get('/api/debug/geocode-env', (_req, res) => {
        const geocoderState = reverseGeocoder.getDebugState();
        res.json({
            ok: true,
            yandexGeocoderApiKeyPresent: geocoderState.hasApiKey,
            yandexGeocoderApiKeyLength: geocoderState.apiKeyLength,
            envSource: bootstrapEnvStatus.source,
            envLoadedFrom: bootstrapEnvStatus.loadedFrom,
            cwd: process.cwd(),
        });
    });
}

app.post('/api/auth/login', (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const row = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').get(username) as
        | { id: number; username: string; password_hash: string; role: Role }
        | undefined;
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        res.status(401).json({ error: 'Неверный логин или пароль' });
        return;
    }
    const token = signToken({ id: row.id, username: row.username, role: row.role });
    res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
});

app.get('/api/me', authMiddleware, (req, res) => {
    const user = (req as express.Request & { user: AuthUser }).user;
    res.json({ user });
});

app.get('/api/dataset/cities', authMiddleware, (_req, res) => {
    res.json({ cities: cityDatasets.listCities() });
});

app.get('/api/dataset/meta', authMiddleware, (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    res.json({ city: ctx.cityId, meta: ctx.store.meta, hasData: Boolean(ctx.store.state?.rows.length) });
});

app.get('/api/dataset/bootstrap', authMiddleware, (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    if (!ctx.store.state?.rows.length) {
        res.status(404).json({ error: 'Серверный датасет пуст для этого города' });
        return;
    }
    if (ctx.store.state.rows.length > MAX_DATASET_ROWS) {
        res.status(413).json({
            error: `Слишком много строк (${ctx.store.state.rows.length}). Максимум ${MAX_DATASET_ROWS.toLocaleString('ru-RU')}.`,
        });
        return;
    }
    const summary = enrichSummary(ctx.store.state.summary, ctx.cityId);
    res.json({
        city: ctx.cityId,
        rows: ctx.store.state.rows,
        summary,
        total: ctx.store.state.rows.length,
    });
});

app.get('/api/summary', authMiddleware, (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    if (!ctx.store.state) {
        res.status(404).json({ error: 'Dataset not loaded' });
        return;
    }
    res.json({
        city: ctx.cityId,
        summary: enrichSummary(ctx.store.state.summary, ctx.cityId),
        total: ctx.store.state.rows.length,
    });
});

app.get('/api/listings', authMiddleware, (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    if (!ctx.store.state) {
        res.status(404).json({ error: 'Dataset not loaded' });
        return;
    }
    const summary = enrichSummary(ctx.store.state.summary, ctx.cityId);
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(200, Math.max(10, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
    const filters = parseFilters(req.query as Record<string, unknown>, summary);
    const filtered = ctx.store.state.rows.filter(row => rowPassesFiltersShared(row, filters, summary));
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    res.json({ city: ctx.cityId, page, pageSize, total: filtered.length, items });
});

app.get('/api/geocode/reverse', authMiddleware, async (req, res) => {
    const lat = Number.parseFloat(String(req.query.lat ?? ''));
    const lng = Number.parseFloat(String(req.query.lng ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ error: 'Нужны корректные query-параметры lat и lng' });
        return;
    }
    try {
        const result = await reverseGeocoder.reverse(lat, lng);
        if (process.env.NODE_ENV !== 'production') {
            const reason = result.fallbackReason ? `(${result.fallbackReason})` : '';
            // eslint-disable-next-line no-console
            console.info(`[reverse-geocode] ${result.source}${reason} ${result.cacheKey}`);
        }
        res.json({ ok: true, ...result });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось выполнить reverse geocoding';
        res.status(400).json({ error: message });
    }
});

app.post('/api/geocode/progress', authMiddleware, (req, res) => {
    const keysRaw = Array.isArray(req.body?.keys) ? req.body.keys : null;
    if (!keysRaw) {
        res.status(400).json({ error: 'Ожидается массив keys в теле запроса' });
        return;
    }
    const keys = keysRaw.map(v => String(v ?? '').trim()).filter(Boolean);
    const snapshot = reverseGeocoder.getProgressSnapshot(keys);
    res.json({
        ok: true,
        ...snapshot,
    });
});

app.get('/api/export.csv', authMiddleware, requireRoles(['analyst', 'admin']), (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    if (!ctx.store.state) {
        res.status(404).json({ error: 'Dataset not loaded' });
        return;
    }
    const summary = enrichSummary(ctx.store.state.summary, ctx.cityId);
    const filters = parseFilters(req.query as Record<string, unknown>, summary);
    const filtered = ctx.store.state.rows.filter(row => rowPassesFiltersShared(row, filters, summary));
    const csv = ctx.store.toCsv(filtered);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="filtered_${ctx.cityId}.csv"`);
    res.send(`\ufeff${csv}`);
});

app.get('/api/admin/dataset/export', authMiddleware, requireRoles(['admin']), (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    if (!ctx.store.state) {
        res.status(404).json({ error: 'Dataset not loaded' });
        return;
    }
    const csv = ctx.store.toCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="server_${ctx.cityId}.csv"`);
    res.send(`\ufeff${csv}`);
});

app.post('/api/admin/dataset', authMiddleware, requireRoles(['admin']), upload.single('file'), (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'Нужен CSV-файл' });
        return;
    }
    const modeRaw = String(req.query.mode ?? 'append').toLowerCase();
    const mode: UploadMode = modeRaw === 'replace' ? 'replace' : 'append';
    try {
        const text = file.buffer.toString('utf8');
        const result = ctx.store.ingestCsv(text, file.originalname || 'upload.csv', mode);
        if (result.totalRows > MAX_DATASET_ROWS) {
            res.status(413).json({
                error: `Слишком много строк (${result.totalRows}). Максимум ${MAX_DATASET_ROWS.toLocaleString('ru-RU')}.`,
            });
            return;
        }
        res.json({
            ok: true,
            city: ctx.cityId,
            mode,
            totalRows: result.totalRows,
            added: result.added,
            skippedDuplicates: result.skippedDuplicates,
            tooFarFiltered: result.tooFarFiltered,
            droppedInvalid: result.droppedInvalid,
            hadIdColumn: result.hadIdColumn,
            duplicateByOfferId: result.duplicateByOfferId,
            meta: ctx.store.meta,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось разобрать CSV';
        res.status(400).json({ error: message });
    }
});

app.post('/api/admin/dataset/ingest-pipeline', authMiddleware, requireRoles(['admin']), (req, res) => {
    const cityId = String(req.body?.city ?? req.query.city ?? '').trim();
    if (!isKnownCityId(cityId)) {
        res.status(400).json({ error: 'Укажите city' });
        return;
    }
    const store = cityDatasets.getStore(cityId);
    if (!store) {
        res.status(400).json({ error: 'Неизвестный город' });
        return;
    }
    const csvPath = processedCsvPath(cityId);
    if (!csvPath || !fs.existsSync(csvPath)) {
        res.status(404).json({
            error: `Файл итоговой таблицы не найден: ${csvPath ?? '—'}. Сначала выполните подготовку итоговой таблицы.`,
        });
        return;
    }
    const modeRaw = String(req.body?.mode ?? req.query.mode ?? 'append').toLowerCase();
    const mode: UploadMode = modeRaw === 'replace' ? 'replace' : 'append';
    try {
        const text = fs.readFileSync(csvPath, 'utf8');
        const result = store.ingestCsv(text, `pipeline:${path.basename(csvPath)}`, mode);
        res.json({
            ok: true,
            city: cityId,
            source: csvPath,
            mode,
            ...result,
            meta: store.meta,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Ingest failed';
        res.status(400).json({ error: message });
    }
});

app.delete('/api/admin/dataset', authMiddleware, requireRoles(['admin']), (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    ctx.store.clearAll();
    res.json({ ok: true, city: ctx.cityId, meta: ctx.store.meta });
});

app.delete('/api/admin/dataset/batch/:batchId', authMiddleware, requireRoles(['admin']), (req, res) => {
    const ctx = getStoreForCity(req, res);
    if (!ctx) return;
    const batchId = String(req.params.batchId ?? '');
    const result = ctx.store.deleteBatch(batchId);
    if (!result) {
        res.status(404).json({ error: 'Партия загрузки не найдена' });
        return;
    }
    res.json({ ok: true, city: ctx.cityId, removed: result.removed, meta: ctx.store.meta });
});

app.get('/api/admin/parser/cities', authMiddleware, requireRoles(['admin']), (_req, res) => {
    const cities = cityDatasets.listCities().map(c => {
        const profile = getCityProfile(c.id);
        return {
            ...c,
            parserConfig: profile?.parserConfig,
            processedPath: processedCsvPath(c.id),
        };
    });
    const activeBase = parserJobs.getActiveJob();
    const activeJob = activeBase ? parserJobs.getJobWithProgress(activeBase.id) : null;
    res.json({ cities, activeJob });
});

app.get('/api/admin/parser/jobs', authMiddleware, requireRoles(['admin']), (req, res) => {
    const cityId = String(req.query.cityId ?? '').trim();
    if (cityId && !isKnownCityId(cityId)) {
        res.status(400).json({ error: 'Некорректный cityId' });
        return;
    }
    const activeBase = parserJobs.getActiveJob();
    const active = activeBase ? parserJobs.getJobWithProgress(activeBase.id) : null;
    res.json({ jobs: parserJobs.listJobs(20, cityId || undefined), active });
});

app.get('/api/admin/parser/jobs/:id', authMiddleware, requireRoles(['admin']), (req, res) => {
    const job = parserJobs.getJobWithProgress(String(req.params.id));
    if (!job) {
        res.status(404).json({ error: 'Задача не найдена' });
        return;
    }
    let logTail: string | null = null;
    if (fs.existsSync(job.logPath)) {
        const raw = fs.readFileSync(job.logPath, 'utf8');
        logTail = raw.slice(-4000);
    }
    res.json({ job, progress: job.progress, logTail });
});

app.post('/api/admin/parser/jobs', authMiddleware, requireRoles(['admin']), (req, res) => {
    const cityId = String(req.body?.cityId ?? '').trim();
    const stage = String(req.body?.stage ?? '').trim() as ParserStage;
    const targetListingsRaw = req.body?.targetListings;
    const targetListingsParsed =
        targetListingsRaw == null || targetListingsRaw === ''
            ? null
            : Number.parseInt(String(targetListingsRaw), 10);
    const targetListings =
        targetListingsParsed != null && Number.isFinite(targetListingsParsed) && targetListingsParsed > 0
            ? targetListingsParsed
            : null;
    const allowed: ParserStage[] = ['links', 'details', 'etl', 'flush', 'pipeline'];
    if (!isKnownCityId(cityId) || !allowed.includes(stage)) {
        res.status(400).json({ error: 'Нужны cityId и stage (links|details|etl|flush|pipeline)' });
        return;
    }
    if (targetListingsRaw != null && targetListingsRaw !== '' && targetListings == null) {
        res.status(400).json({ error: 'Лимит квартир должен быть целым числом больше 0' });
        return;
    }
    const result = parserJobs.startJob(cityId, stage, { targetListings });
    if (!result.ok) {
        res.status(409).json({ error: result.error });
        return;
    }
    res.status(201).json({ job: result.job });
});

app.post('/api/admin/parser/jobs/:id/resume', authMiddleware, requireRoles(['admin']), (req, res) => {
    const result = parserJobs.resumeCaptcha(String(req.params.id));
    if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
    }
    res.json({ ok: true });
});

app.delete('/api/admin/parser/jobs/:id', authMiddleware, requireRoles(['admin']), (req, res) => {
    const result = parserJobs.cancelJob(String(req.params.id));
    if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
    }
    res.json({ ok: true });
});

app.get('/api/manager/markets/overview', authMiddleware, requireRoles(['manager']), (_req, res) => {
    res.json({ cities: buildMarketsOverview(cityDatasets) });
});

app.get('/api/manager/users', authMiddleware, requireRoles(['manager']), (_req, res) => {
    res.json({ users: userAdmin.listUsers() });
});

app.post('/api/manager/users', authMiddleware, requireRoles(['manager']), (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const roleRaw = String(req.body?.role ?? 'observer');
    if (!isRole(roleRaw)) {
        res.status(400).json({ error: 'Некорректная роль' });
        return;
    }
    try {
        const user = userAdmin.createUser(username, password, roleRaw);
        res.status(201).json({ user });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось создать пользователя';
        res.status(400).json({ error: message });
    }
});

app.patch('/api/manager/users/:id', authMiddleware, requireRoles(['manager']), (req, res) => {
    const targetId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(targetId)) {
        res.status(400).json({ error: 'Некорректный id' });
        return;
    }
    const actor = (req as express.Request & { user: AuthUser }).user;
    const roleRaw = req.body?.role != null ? String(req.body.role) : null;
    if (roleRaw != null) {
        if (!isRole(roleRaw)) {
            res.status(400).json({ error: 'Некорректная роль' });
            return;
        }
        try {
            const user = userAdmin.updateRole(targetId, roleRaw, actor.id);
            res.json({ user });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Не удалось обновить роль';
            res.status(400).json({ error: message });
        }
        return;
    }
    res.status(400).json({ error: 'Укажите role' });
});

app.patch('/api/manager/users/:id/password', authMiddleware, requireRoles(['manager']), (req, res) => {
    const targetId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(targetId)) {
        res.status(400).json({ error: 'Некорректный id' });
        return;
    }
    const password = String(req.body?.password ?? '');
    try {
        userAdmin.updatePassword(targetId, password);
        res.json({ ok: true });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось сменить пароль';
        res.status(400).json({ error: message });
    }
});

app.delete('/api/manager/users/:id', authMiddleware, requireRoles(['manager']), (req, res) => {
    const targetId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(targetId)) {
        res.status(400).json({ error: 'Некорректный id' });
        return;
    }
    const actor = (req as express.Request & { user: AuthUser }).user;
    try {
        userAdmin.deleteUser(targetId, actor.id);
        res.json({ ok: true });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось удалить пользователя';
        res.status(400).json({ error: message });
    }
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `Файл слишком большой (макс. ${MAX_DATASET_BYTES / (1024 * 1024)} МБ)` });
        return;
    }
    next(err);
});

app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${PORT}`);
    if (IS_DEV) {
        const geocoderState = reverseGeocoder.getDebugState();
        // eslint-disable-next-line no-console
        console.log(`[api] geocoder key present: ${geocoderState.hasApiKey ? 'yes' : 'no'}`);
    }
});
