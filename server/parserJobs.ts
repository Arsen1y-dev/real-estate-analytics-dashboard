import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
    ParserJob as SharedParserJob,
    ParserJobStatus,
    ParserJobWithProgress,
    ParserPipelineStage,
    ParserProgress as ParserJobProgress,
    ParserProgressStatus,
    ParserProgressSummary,
    ParserStage,
} from '../shared/parserProgress';
import { readJsonFileSafe, spawnParserJob, statsPaths } from './parserRunner';
export type ParserJobRow = SharedParserJob;

export function initParserJobsSchema(db: Database.Database): void {
    db.exec(`
CREATE TABLE IF NOT EXISTS parser_jobs (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  pid INTEGER,
  config_path TEXT NOT NULL,
  log_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  last_error TEXT,
  target_listings INTEGER
);
`);
    const columns = db
        .prepare(`PRAGMA table_info(parser_jobs)`)
        .all() as Array<{ name?: unknown }>;
    const hasTargetListings = columns.some(column => String(column.name) === 'target_listings');
    if (!hasTargetListings) {
        db.exec(`ALTER TABLE parser_jobs ADD COLUMN target_listings INTEGER`);
    }
}

type StageRange = {
    min: number;
    max: number;
};

const PIPELINE_STAGE_RANGES: Record<ParserPipelineStage, StageRange> = {
    QUEUED: { min: 0, max: 2 },
    PREPARING_ENV: { min: 3, max: 12 },
    STARTING_BROWSER: { min: 13, max: 24 },
    COLLECTING_LINKS: { min: 25, max: 58 },
    PARSING_DETAILS: { min: 59, max: 86 },
    ETL_PROCESSING: { min: 87, max: 95 },
    SAVING_DATASET: { min: 96, max: 99 },
    COMPLETED: { min: 100, max: 100 },
    FAILED: { min: 0, max: 100 },
    CANCELLED: { min: 0, max: 100 },
};

const PIPELINE_STAGE_LABELS: Record<ParserPipelineStage, string> = {
    QUEUED: 'В очереди',
    PREPARING_ENV: 'Подготовка окружения',
    STARTING_BROWSER: 'Запуск браузера',
    COLLECTING_LINKS: 'Сбор ссылок',
    PARSING_DETAILS: 'Парсинг карточек',
    ETL_PROCESSING: 'Подготовка итоговой таблицы',
    SAVING_DATASET: 'Сохранение датасета',
    COMPLETED: 'Завершено',
    FAILED: 'Ошибка',
    CANCELLED: 'Остановлено',
};

function clampPercent(raw: number): number {
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(100, Math.round(raw)));
}

export class ParserJobService {
    private db: Database.Database;
    private jobsDir: string;
    private activeChild: { jobId: string; pid: number } | null = null;

    constructor(db: Database.Database, dataDir: string) {
        this.db = db;
        this.jobsDir = path.join(dataDir, 'parser-jobs');
        fs.mkdirSync(this.jobsDir, { recursive: true });
        initParserJobsSchema(db);
        this.recoverStaleRunning();
    }

    private recoverStaleRunning(): void {
        const rows = this.db
            .prepare(`SELECT id, pid FROM parser_jobs WHERE status = 'running'`)
            .all() as { id: string; pid: number | null }[];
        for (const row of rows) {
            this.db.prepare(
                `UPDATE parser_jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?`
            ).run(new Date().toISOString(), 'Прервано при перезапуске API', row.id);
        }
    }

    getActiveJob(): ParserJobRow | null {
        const row = this.db
            .prepare(`SELECT * FROM parser_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`)
            .get() as Record<string, unknown> | undefined;
        return row ? this.mapRow(row) : null;
    }

    listJobs(limit = 20, cityId?: string): ParserJobWithProgress[] {
        const rows = (cityId
            ? this.db.prepare(`SELECT * FROM parser_jobs WHERE city_id = ? ORDER BY started_at DESC LIMIT ?`).all(cityId, limit)
            : this.db.prepare(`SELECT * FROM parser_jobs ORDER BY started_at DESC LIMIT ?`).all(limit)) as Record<string, unknown>[];
        return rows.map(r => this.withProgress(this.mapRow(r)));
    }

    getJob(id: string): ParserJobRow | null {
        const row = this.db.prepare(`SELECT * FROM parser_jobs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
        return row ? this.mapRow(row) : null;
    }

    getJobWithProgress(id: string): ParserJobWithProgress | null {
        const job = this.getJob(id);
        return job ? this.withProgress(job) : null;
    }

    startJob(
        cityId: string,
        stage: ParserStage,
        options?: { targetListings?: number | null }
    ): { ok: true; job: ParserJobRow } | { ok: false; error: string } {
        if (this.getActiveJob()) {
            return { ok: false, error: 'Уже выполняется другая задача парсера (один Chrome)' };
        }

        const id = randomUUID();
        const logPath = path.join(this.jobsDir, `${id}.log`);
        const startedAt = new Date().toISOString();

        const targetListings =
            options?.targetListings != null && options.targetListings > 0 ? Math.floor(options.targetListings) : null;
        const spawned = spawnParserJob(cityId, stage, logPath, { targetListings });
        if ('error' in spawned) {
            return { ok: false, error: spawned.error };
        }

        const { child, configPath } = spawned;
        const pid = child.pid ?? null;

        this.db.prepare(
            `INSERT INTO parser_jobs (id, city_id, stage, status, pid, config_path, log_path, started_at, target_listings)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`
        ).run(id, cityId, stage, pid, configPath, logPath, startedAt, targetListings);

        this.activeChild = pid != null ? { jobId: id, pid } : null;

        child.on('exit', (code, signal) => {
            const finishedAt = new Date().toISOString();
            const status: ParserJobStatus = signal === 'SIGTERM' ? 'cancelled' : code === 0 ? 'completed' : 'failed';
            const lastError =
                status === 'failed' ? `exit code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}` : null;
            this.db.prepare(
                `UPDATE parser_jobs SET status = ?, finished_at = ?, exit_code = ?, last_error = ? WHERE id = ?`
            ).run(status, finishedAt, code, lastError, id);
            if (this.activeChild?.jobId === id) this.activeChild = null;
        });

        child.on('error', err => {
            this.db.prepare(
                `UPDATE parser_jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?`
            ).run(new Date().toISOString(), err.message, id);
            if (this.activeChild?.jobId === id) this.activeChild = null;
        });

        const job = this.getJob(id);
        return job ? { ok: true, job } : { ok: false, error: 'Не удалось создать задачу' };
    }

    cancelJob(id: string): { ok: true } | { ok: false; error: string } {
        const job = this.getJob(id);
        if (!job) return { ok: false, error: 'Задача не найдена' };
        if (job.status !== 'running') return { ok: false, error: 'Задача не выполняется' };
        if (job.pid != null) {
            try {
                process.kill(job.pid, 'SIGTERM');
            } catch {
                /* already dead */
            }
        }
        return { ok: true };
    }

    resumeCaptcha(id: string): { ok: true } | { ok: false; error: string } {
        const job = this.getJob(id);
        if (!job) return { ok: false, error: 'Задача не найдена' };
        if (job.status !== 'running') return { ok: false, error: 'Задача не выполняется' };
        const paths = statsPaths(job.cityId);
        const controlPath = paths.runtimeControl;
        if (!controlPath) return { ok: false, error: 'Для города не настроен runtime_control_file' };
        const payload = { resume_requested_at: new Date().toISOString() };
        fs.mkdirSync(path.dirname(controlPath), { recursive: true });
        fs.writeFileSync(controlPath, JSON.stringify(payload, null, 2), 'utf8');
        return { ok: true };
    }

    getJobProgress(
        job: Pick<ParserJobRow, 'cityId' | 'stage' | 'status' | 'logPath' | 'targetListings' | 'startedAt' | 'lastError'>
    ): ParserJobProgress {
        const paths = statsPaths(job.cityId);
        const linksStats = readJsonFileSafe<Record<string, unknown>>(paths.links);
        const detailsStats = readJsonFileSafe<Record<string, unknown>>(paths.details);
        return this.buildProgress(job.stage, job.status, linksStats, detailsStats, paths, job);
    }

    private mapRow(row: Record<string, unknown>): ParserJobRow {
        return {
            id: String(row.id),
            cityId: String(row.city_id),
            stage: String(row.stage) as ParserStage,
            status: String(row.status) as ParserJobStatus,
            pid: row.pid != null ? Number(row.pid) : null,
            configPath: String(row.config_path),
            logPath: String(row.log_path),
            startedAt: String(row.started_at),
            finishedAt: row.finished_at != null ? String(row.finished_at) : null,
            exitCode: row.exit_code != null ? Number(row.exit_code) : null,
            lastError: row.last_error != null ? String(row.last_error) : null,
            targetListings: row.target_listings != null ? Number(row.target_listings) : null,
        };
    }

    private withProgress(job: ParserJobRow): ParserJobWithProgress {
        return { ...job, progress: this.getJobProgress(job) };
    }

    private buildProgress(
        stage: ParserStage,
        status: ParserJobStatus,
        linksStats: Record<string, unknown> | null,
        detailsStats: Record<string, unknown> | null,
        paths: { links?: string; details?: string; runtimeStatus?: string; runtimeControl?: string },
        job: Pick<ParserJobRow, 'logPath' | 'targetListings' | 'startedAt' | 'lastError'>
    ): ParserJobProgress {
        const asNumber = (raw: unknown): number | null => {
            if (raw == null || raw === '') return null;
            const num = Number(raw);
            return Number.isFinite(num) ? num : null;
        };
        const percentFrom = (done: number | null, total: number | null): number | null => {
            if (done == null || total == null || total <= 0) return null;
            return clampPercent((done / total) * 100);
        };
        const linksDone = asNumber(linksStats?.pages_parsed);
        const linksTotal = asNumber(linksStats?.max_pages);
        const linksCollected = asNumber(linksStats?.total_links);
        const detailsDone = asNumber(detailsStats?.processed_links);
        const detailsTotal = asNumber(detailsStats?.total_links);
        const detailsCollectedTotal = asNumber(detailsStats?.collected_total);
        const detailsTarget = asNumber(detailsStats?.target_listings) ?? job.targetListings;
        const detailsCaptchaState =
            typeof detailsStats?.captcha_state === 'string' ? String(detailsStats.captcha_state) : null;

        let done: number | null = null;
        let total: number | null = null;
        let label = `Стадия ${stage}`;
        let details: string | null = null;
        let step: string | null = null;

        if (stage === 'links') {
            done = linksDone;
            total = linksTotal;
            label = 'Сбор ссылок';
            step = 'Обход страниц выдачи';
            details = linksCollected != null ? `Найдено ссылок: ${linksCollected}` : null;
        } else if (stage === 'details') {
            if (detailsTarget != null && detailsTarget > 0) {
                done = detailsCollectedTotal ?? detailsDone;
                total = detailsTarget;
            } else {
                done = detailsDone;
                total = detailsTotal;
            }
            label = 'Парсинг карточек';
            step = 'Парсинг карточек объявлений';
            const ok = asNumber(detailsStats?.successful_parses);
            const failed = asNumber(detailsStats?.failed_parses);
            const parts = [
                ok != null ? `успешно ${ok}` : null,
                failed != null ? `ошибок ${failed}` : null,
                detailsTarget != null && detailsTarget > 0 && done != null ? `собрано ${done}/${detailsTarget}` : null,
            ].filter(Boolean);
            details = parts.length ? parts.join(', ') : null;
        } else if (stage === 'flush') {
            label = 'Слияние tmp -> details';
            step = 'Слияние промежуточного файла';
        } else if (stage === 'etl') {
            label = 'Подготовка итоговой таблицы';
            step = 'Преобразование в dashboard CSV';
        } else if (stage === 'pipeline') {
            label = 'Полный pipeline';
            step = 'Последовательный запуск стадий';
            if (detailsTarget != null && detailsTarget > 0) {
                done = detailsCollectedTotal ?? detailsDone;
                total = detailsTarget;
                details = 'Этап details (лимит карточек)';
            } else if (detailsDone != null && detailsTotal != null) {
                done = detailsDone;
                total = detailsTotal;
                details = 'Этап details';
            } else if (linksDone != null && linksTotal != null) {
                done = linksDone;
                total = linksTotal;
                details = 'Этап links';
            }
        }

        if (status === 'completed') {
            if (done == null) done = total ?? 1;
            if (total == null) total = done;
        }
        const runtimeStatus = readJsonFileSafe<Record<string, unknown>>(paths.runtimeStatus);
        const runtimeStep = typeof runtimeStatus?.step === 'string' ? runtimeStatus.step : null;
        const runtimeDone = asNumber(runtimeStatus?.done);
        const runtimeTotal = asNumber(runtimeStatus?.total);
        const runtimeCollected = asNumber(runtimeStatus?.collected_total ?? runtimeStatus?.collectedListings ?? runtimeStatus?.done);
        const runtimeStage = typeof runtimeStatus?.stage === 'string' ? runtimeStatus.stage.trim().toLowerCase() : null;
        const runtimeMessage =
            typeof runtimeStatus?.statusMessage === 'string'
                ? runtimeStatus.statusMessage
                : typeof runtimeStatus?.message === 'string'
                  ? runtimeStatus.message
                  : null;
        if (runtimeDone != null) done = runtimeDone;
        if (runtimeTotal != null) total = runtimeTotal;
        if (runtimeStep) step = runtimeStep;
        const transientStatus = this.parseTransientProgressStatus(job.logPath, status, detailsCaptchaState, runtimeStatus);
        const collectedListings = runtimeCollected ?? detailsCollectedTotal ?? done;
        const targetListings = asNumber(runtimeStatus?.target_listings) ?? detailsTarget ?? job.targetListings;
        const exactPercent = percentFrom(done, total);
        const pipelineStage = this.resolvePipelineStage({
            stage,
            status: transientStatus,
            runtimeStage,
            step,
            logPath: job.logPath,
        });
        const percent = this.resolveProgressPercent({
            pipelineStage,
            exactPercent,
            done,
            total,
            transientStatus,
            targetListings,
            collectedListings,
        });

        const pickMTime = (p: string | undefined): number | null => {
            if (!p || !fs.existsSync(p)) return null;
            try {
                return fs.statSync(p).mtimeMs;
            } catch {
                return null;
            }
        };
        const mtimes = [pickMTime(paths.links), pickMTime(paths.details), pickMTime(paths.runtimeStatus)].filter(
            (v): v is number => v != null
        );
        const updatedAt = mtimes.length ? new Date(Math.max(...mtimes)).toISOString() : null;
        let etaSeconds: number | null = null;
        if (transientStatus === 'running' && exactPercent != null && exactPercent > 0 && exactPercent < 100) {
            const elapsedSec = Math.max(1, (Date.now() - Date.parse(job.startedAt)) / 1000);
            const ratePercent = exactPercent / elapsedSec;
            if (ratePercent > 0) etaSeconds = Math.max(1, Math.round((100 - exactPercent) / ratePercent));
        }
        const errorReason = this.resolveErrorReason({
            status: transientStatus,
            runtimeStatus,
            lastError: job.lastError,
            logPath: job.logPath,
        });
        const summary: ParserProgressSummary = {
            collectedListings,
            targetListings,
            linksCollected,
            linksProcessed: detailsDone,
        };
        const stageLabel = PIPELINE_STAGE_LABELS[pipelineStage];
        const statusMessage =
            runtimeMessage ??
            (errorReason
                ? `${stageLabel}: ${errorReason}`
                : [stageLabel, step, details].filter(Boolean).join(' — ') || `${stageLabel}.`);

        return {
            stage,
            status: transientStatus,
            label,
            step,
            details,
            done,
            total,
            percent,
            etaSeconds,
            targetListings,
            collectedListings,
            updatedAt,
            linksStats,
            detailsStats,
            pipelineStage,
            statusMessage,
            errorReason,
            summary,
        };
    }

    private parseTransientProgressStatus(
        logPath: string,
        fallback: ParserJobStatus,
        detailsCaptchaState: string | null,
        runtimeStatus: Record<string, unknown> | null
    ): ParserProgressStatus {
        if (fallback !== 'running') return fallback;
        const runtimeRaw = typeof runtimeStatus?.status === 'string' ? runtimeStatus.status : null;
        const runtimeMapped = this.mapCaptchaState(runtimeRaw);
        if (runtimeMapped) return runtimeMapped;
        const fromStats = this.mapCaptchaState(detailsCaptchaState);
        if (fromStats) return fromStats;
        const tail = this.readLogTail(logPath, 8_000);
        if (!tail) return fallback;
        const markerMatches = [...tail.matchAll(/PARSER_PROGRESS_STATUS:([a-z_]+)/g)];
        if (markerMatches.length === 0) return fallback;
        const last = markerMatches.at(-1)?.[1] ?? '';
        return this.mapCaptchaState(last) ?? fallback;
    }

    private resolvePipelineStage(input: {
        stage: ParserStage;
        status: ParserProgressStatus;
        runtimeStage: string | null;
        step: string | null;
        logPath: string;
    }): ParserPipelineStage {
        if (input.status === 'queued') return 'QUEUED';
        if (input.status === 'completed') return 'COMPLETED';
        if (input.status === 'failed') return 'FAILED';
        if (input.status === 'cancelled') return 'CANCELLED';
        if (input.status === 'captcha_required' || input.status === 'waiting_user') return 'PARSING_DETAILS';

        const stepLower = input.step?.toLowerCase() ?? '';
        const runtime = input.runtimeStage;
        if (runtime === 'links') return 'COLLECTING_LINKS';
        if (runtime === 'details') return 'PARSING_DETAILS';
        if (runtime === 'etl') return 'ETL_PROCESSING';
        if (runtime === 'flush' || runtime === 'handoff' || runtime === 'saving') return 'SAVING_DATASET';
        if (runtime === 'pipeline' && stepLower) {
            if (stepLower.includes('link')) return 'COLLECTING_LINKS';
            if (stepLower.includes('detail') || stepLower.includes('карточ')) return 'PARSING_DETAILS';
            if (stepLower.includes('etl')) return 'ETL_PROCESSING';
            if (stepLower.includes('handoff') || stepLower.includes('save') || stepLower.includes('сохран')) {
                return 'SAVING_DATASET';
            }
        }
        if (stepLower.includes('подготов')) return 'PREPARING_ENV';
        if (stepLower.includes('брауз') || stepLower.includes('chrome') || stepLower.includes('driver')) {
            return 'STARTING_BROWSER';
        }
        if (input.stage === 'links') return 'COLLECTING_LINKS';
        if (input.stage === 'details') return 'PARSING_DETAILS';
        if (input.stage === 'etl') return 'ETL_PROCESSING';
        if (input.stage === 'flush') return 'SAVING_DATASET';
        if (input.stage === 'pipeline') {
            const tail = this.readLogTail(input.logPath, 4_000)?.toLowerCase() ?? '';
            if (tail.includes('pipeline.run_links')) return 'COLLECTING_LINKS';
            if (tail.includes('pipeline.run_details')) return 'PARSING_DETAILS';
            if (tail.includes('pipeline.etl')) return 'ETL_PROCESSING';
            if (tail.includes('handoff') || tail.includes('pipeline completed')) return 'SAVING_DATASET';
        }
        return 'PREPARING_ENV';
    }

    private resolveProgressPercent(input: {
        pipelineStage: ParserPipelineStage;
        exactPercent: number | null;
        done: number | null;
        total: number | null;
        transientStatus: ParserProgressStatus;
        targetListings: number | null;
        collectedListings: number | null;
    }): number {
        if (input.transientStatus === 'completed') return 100;
        if (input.transientStatus === 'queued') return 0;
        if (input.exactPercent != null) return input.exactPercent;
        if (input.transientStatus === 'failed' || input.transientStatus === 'cancelled') {
            return Math.max(PIPELINE_STAGE_RANGES[input.pipelineStage].min, 5);
        }
        const range = PIPELINE_STAGE_RANGES[input.pipelineStage];
        if (
            input.targetListings != null &&
            input.targetListings > 0 &&
            input.collectedListings != null &&
            input.pipelineStage === 'PARSING_DETAILS'
        ) {
            const relative = clampPercent((input.collectedListings / input.targetListings) * 100);
            const scaled = range.min + ((range.max - range.min) * relative) / 100;
            return clampPercent(scaled);
        }
        if (input.done != null && input.total != null && input.total > 0) {
            const relative = clampPercent((input.done / input.total) * 100);
            const scaled = range.min + ((range.max - range.min) * relative) / 100;
            return clampPercent(scaled);
        }
        return Math.max(range.min, Math.min(range.max, range.min + 2));
    }

    private resolveErrorReason(input: {
        status: ParserProgressStatus;
        runtimeStatus: Record<string, unknown> | null;
        lastError: string | null;
        logPath: string;
    }): string | null {
        if (input.status !== 'failed' && input.status !== 'cancelled') return null;
        const runtimeError =
            typeof input.runtimeStatus?.error === 'string'
                ? input.runtimeStatus.error
                : typeof input.runtimeStatus?.statusMessage === 'string'
                  ? input.runtimeStatus.statusMessage
                  : null;
        if (runtimeError) return runtimeError.trim();
        if (input.lastError) return input.lastError.trim();
        const tail = this.readLogTail(input.logPath, 10_000);
        if (!tail) return null;
        const lines = tail
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
            const line = lines[idx];
            if (line.toLowerCase().includes('traceback')) continue;
            if (/error|exception|failed|fatal|❌/i.test(line)) return line;
        }
        return null;
    }

    private readLogTail(logPath: string, maxChars: number): string | null {
        if (!logPath || !fs.existsSync(logPath)) return null;
        try {
            const raw = fs.readFileSync(logPath, 'utf8');
            return raw.slice(-maxChars);
        } catch {
            return null;
        }
    }

    private mapCaptchaState(raw: string | null): ParserProgressStatus | null {
        if (!raw) return null;
        if (raw === 'captcha_required') return 'captcha_required';
        if (raw === 'waiting_user' || raw === 'waiting_captcha') return 'waiting_user';
        return null;
    }
}
