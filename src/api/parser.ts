import { apiBaseUrl } from '@/auth';
import type { CityId } from '@/domain/city';
import type {
    ParserJob,
    ParserJobWithProgress,
    ParserProgress,
    ParserStage,
} from '../../shared/parserProgress';
export type { ParserJob, ParserJobWithProgress, ParserProgress, ParserStage } from '../../shared/parserProgress';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asParserJob(input: unknown): ParserJob | null {
    if (!isRecord(input)) return null;
    if (typeof input.id !== 'string') return null;
    if (typeof input.cityId !== 'string') return null;
    if (typeof input.stage !== 'string') return null;
    if (typeof input.status !== 'string') return null;
    if (typeof input.configPath !== 'string') return null;
    if (typeof input.logPath !== 'string') return null;
    if (typeof input.startedAt !== 'string') return null;
    return input as ParserJob;
}

function asParserProgress(input: unknown): ParserProgress | null {
    if (!isRecord(input)) return null;
    if (typeof input.stage !== 'string') return null;
    if (typeof input.status !== 'string') return null;
    if (typeof input.label !== 'string') return null;
    if (typeof input.pipelineStage !== 'string') return null;
    if (typeof input.statusMessage !== 'string') return null;
    if (!isRecord(input.summary)) return null;
    return input as ParserProgress;
}

function asParserJobWithProgress(input: unknown): ParserJobWithProgress | null {
    if (!isRecord(input)) return null;
    const job = asParserJob(input);
    if (!job) return null;
    const progress = asParserProgress(input.progress);
    if (!progress) return null;
    return { ...job, progress };
}

export async function fetchParserCities(token: string): Promise<{
    cities: Array<{ id: CityId; label: string; processedPath?: string }>;
    activeJob: ParserJob | null;
}> {
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/cities`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { cities: [], activeJob: null };
    const data: unknown = await resp.json();
    if (!isRecord(data)) return { cities: [], activeJob: null };
    const citiesRaw = Array.isArray(data.cities) ? data.cities : [];
    const cities = citiesRaw
        .filter(isRecord)
        .filter(item => typeof item.id === 'string' && typeof item.label === 'string')
        .map(item => ({
            id: item.id as CityId,
            label: String(item.label),
            processedPath: typeof item.processedPath === 'string' ? item.processedPath : undefined,
        }));
    return { cities, activeJob: asParserJob(data.activeJob) };
}

export async function fetchParserJobs(
    token: string,
    cityId?: CityId
): Promise<{ jobs: ParserJobWithProgress[]; active: ParserJobWithProgress | null }> {
    const search = new URLSearchParams();
    if (cityId) search.set('cityId', cityId);
    const query = search.toString();
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/jobs${query ? `?${query}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { jobs: [], active: null };
    const data: unknown = await resp.json();
    if (!isRecord(data)) return { jobs: [], active: null };
    const jobsRaw = Array.isArray(data.jobs) ? data.jobs : [];
    const jobs = jobsRaw.map(asParserJobWithProgress).filter((item): item is ParserJobWithProgress => item != null);
    return { jobs, active: asParserJobWithProgress(data.active) };
}

export async function startParserJob(
    token: string,
    cityId: CityId,
    stage: ParserStage,
    targetListings?: number | null
): Promise<{ ok: true; job: ParserJob } | { ok: false; error: string }> {
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/jobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityId, stage, targetListings }),
    });
    const data: unknown = await resp.json();
    if (!isRecord(data)) return { ok: false, error: 'Некорректный ответ сервера' };
    if (!resp.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : 'Не удалось запустить' };
    const job = asParserJob(data.job);
    if (!job) return { ok: false, error: 'Нет данных задачи' };
    return { ok: true, job };
}

export async function fetchParserJob(
    token: string,
    jobId: string
): Promise<{ job: ParserJobWithProgress; progress: ParserProgress; logTail: string | null } | null> {
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data: unknown = await resp.json();
    if (!isRecord(data)) return null;
    const job = asParserJobWithProgress(data.job);
    const progress = asParserProgress(data.progress);
    if (!job || !progress) return null;
    return {
        job,
        progress,
        logTail: typeof data.logTail === 'string' ? data.logTail : null,
    };
}

export async function cancelParserJob(token: string, jobId: string): Promise<boolean> {
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok;
}

export async function resumeParserCaptcha(token: string, jobId: string): Promise<boolean> {
    const resp = await fetch(`${apiBaseUrl()}/api/admin/parser/jobs/${jobId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok;
}
