import React, { useCallback, useEffect, useState } from 'react';
import type { CityId } from '@/domain/city';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { useAuth } from '@/auth';
import {
    cancelParserJob,
    fetchParserJobs,
    fetchParserJob,
    resumeParserCaptcha,
    startParserJob,
    type ParserJobWithProgress,
    type ParserProgress,
    type ParserStage,
} from '@/api/parser';
import { ingestPipelineDataset } from '@/api/dataset';
import { CONTROL_BUTTON_BASE, CONTROL_SELECT_BASE, CONTROL_TEXT } from '@/components/controlStyles';

const STAGES: { id: ParserStage; label: string }[] = [
    { id: 'links', label: 'Собрать ссылки' },
    { id: 'details', label: 'Собрать карточки' },
    { id: 'flush', label: 'Сохранить временные данные' },
    { id: 'etl', label: 'Подготовить итоговую таблицу' },
    { id: 'pipeline', label: 'Запустить весь процесс сразу' },
];

export function AdminParserPanel({
    theme,
    cityId,
    onToast,
    onIngested,
}: {
    theme: Theme;
    cityId: CityId;
    onToast: (message: string) => void;
    onIngested?: () => void;
}) {
    const { token } = useAuth();
    const [activeJob, setActiveJob] = useState<ParserJobWithProgress | null>(null);
    const [latestCityJob, setLatestCityJob] = useState<ParserJobWithProgress | null>(null);
    const [busy, setBusy] = useState(false);
    const [targetListingsInput, setTargetListingsInput] = useState<string>('');
    const [progress, setProgress] = useState<ParserProgress | null>(null);
    const [logTail, setLogTail] = useState<string | null>(null);
    const activeInOtherCity = activeJob?.status === 'running' && activeJob.cityId !== cityId;
    const runningForCurrentCity = activeJob?.status === 'running' && activeJob.cityId === cityId;

    const refresh = useCallback(async () => {
        if (!token) return;
        const data = await fetchParserJobs(token, cityId);
        setActiveJob(data.active);
        const latest = data.jobs[0] ?? null;
        setLatestCityJob(latest);
        if (latest) {
            const detail = await fetchParserJob(token, latest.id);
            if (detail) {
                setProgress(detail.progress);
                setLogTail(detail.logTail);
                return;
            }
        }
        setProgress(null);
        setLogTail(null);
    }, [token, cityId]);

    useEffect(() => {
        void refresh();
        const t = window.setInterval(() => void refresh(), 5000);
        return () => window.clearInterval(t);
    }, [refresh, cityId]);

    const runStage = async (stage: ParserStage) => {
        if (!token) return;
        setBusy(true);
        try {
            const parsedLimit = Number.parseInt(targetListingsInput, 10);
            const targetListings = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
            const result = await startParserJob(
                token,
                cityId,
                stage,
                stage === 'links' || stage === 'details' || stage === 'pipeline' ? targetListings : null
            );
            if (!result.ok) {
                onToast(result.error);
                return;
            }
            setActiveJob({ ...result.job, progress: progress ?? fallbackProgress(stage) });
            setLatestCityJob({ ...result.job, progress: progress ?? fallbackProgress(stage) });
            const targetNote =
                (stage === 'links' || stage === 'details' || stage === 'pipeline') && targetListings
                    ? `, лимит ${targetListings}`
                    : '';
            onToast(`Запущено: ${formatStage(stage)}${targetNote} (${result.job.id.slice(0, 8)}…)`);
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const displayedProgress = progress ?? latestCityJob?.progress ?? null;
    const progressStatus = displayedProgress?.status ?? latestCityJob?.status ?? null;
    const canResumeCaptcha = progressStatus === 'captcha_required' || progressStatus === 'waiting_user';
    const showLogTail = Boolean(
        logTail &&
            latestCityJob &&
            (latestCityJob.status === 'running' || latestCityJob.status === 'failed' || latestCityJob.status === 'cancelled')
    );
    const progressPercent = displayedProgress ? getDisplayPercent(displayedProgress) : null;
    const progressRatio = displayedProgress ? formatProgressRatio(displayedProgress.done, displayedProgress.total) : null;
    const progressCounters = displayedProgress ? buildProgressCounters(displayedProgress) : [];
    const showEta = displayedProgress ? shouldShowEta(displayedProgress) : false;

    const handleIngest = async () => {
        if (!token) return;
        setBusy(true);
        try {
            const result = await ingestPipelineDataset(token, cityId, 'append');
            if (!result.ok) {
                onToast(result.error);
                return;
            }
            const reasons: string[] = [];
            if (result.data.duplicateByOfferId > 0) reasons.push(`offer_id ${result.data.duplicateByOfferId}`);
            if (result.data.tooFarFiltered > 0) reasons.push(`вне 400км ${result.data.tooFarFiltered}`);
            if (result.data.droppedInvalid > 0) reasons.push(`невалидных ${result.data.droppedInvalid}`);
            onToast(
                `На сервер: +${result.data.added}, дубликатов ${result.data.skippedDuplicates}${reasons.length ? ` (${reasons.join(', ')})` : ''}, всего ${result.data.totalRows}`
            );
            onIngested?.();
        } finally {
            setBusy(false);
        }
    };

    return (
        <section
            className={themeClass(theme, {
                dark: 'rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-6',
                light: 'rounded-2xl border border-violet-200/80 bg-violet-50/50 p-6',
            })}
        >
            <h2
                className={themeClass(theme, {
                    dark: 'font-display text-lg font-semibold text-violet-100',
                    light: 'font-display text-lg font-semibold text-violet-950',
                })}
            >
                Парсер Яндекс.Недвижимость
            </h2>
            {latestCityJob && (
                <p className="mt-2 text-xs text-zinc-500">
                    {latestCityJob.cityId === cityId ? 'Последняя задача' : 'Активная задача'}:{' '}
                    {formatStage(latestCityJob.stage)} ·{' '}
                    {formatProgressStatus(latestCityJob.status)}
                    {latestCityJob.lastError ? ` · ${latestCityJob.lastError}` : ''}
                </p>
            )}
            {activeInOtherCity && (
                <p className="mt-2 text-xs text-amber-500">
                    Сейчас выполняется задача для города {activeJob?.cityId}. Новую стадию можно запустить после завершения.
                </p>
            )}
            {displayedProgress && (
                <div
                    className={themeClass(theme, {
                        dark: `mt-3 space-y-3 rounded-xl border p-3 sm:p-4 ${statusBoxClasses('dark', progressStatus)}`,
                        light: `mt-3 space-y-3 rounded-xl border p-3 sm:p-4 ${statusBoxClasses('light', progressStatus)}`,
                    })}
                >
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className={statusBadgeClasses(progressStatus)}>{formatProgressStatus(progressStatus)}</span>
                        <p
                            className={`min-w-0 text-sm font-medium ${themeClass(theme, {
                                dark: 'text-zinc-100',
                                light: 'text-zinc-900',
                            })}`}
                        >
                            {formatPipelineStage(displayedProgress.pipelineStage)}
                        </p>
                        {displayedProgress.updatedAt ? (
                            <span
                                className={`ml-auto text-xs ${themeClass(theme, {
                                    dark: 'text-zinc-400',
                                    light: 'text-zinc-600',
                                })}`}
                            >
                                Обновлено в {new Date(displayedProgress.updatedAt).toLocaleTimeString('ru-RU')}
                            </span>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {(progressRatio || progressPercent != null) && (
                            <span
                                className={themeClass(theme, {
                                    dark: 'rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-2.5 py-1 text-xs text-zinc-200',
                                    light: 'rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-1 text-xs text-zinc-700',
                                })}
                            >
                                Выполнено{' '}
                                {[progressPercent != null ? `${progressPercent}%` : null, progressRatio]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        )}
                        {displayedProgress.targetListings != null ? (
                            <span
                                className={themeClass(theme, {
                                    dark: 'rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-2.5 py-1 text-xs text-zinc-300',
                                    light: 'rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-1 text-xs text-zinc-700',
                                })}
                            >
                                Лимит: {displayedProgress.targetListings}
                            </span>
                        ) : null}
                        {showEta ? (
                            <span
                                className={themeClass(theme, {
                                    dark: 'rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-2.5 py-1 text-xs text-zinc-300',
                                    light: 'rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-1 text-xs text-zinc-700',
                                })}
                            >
                                До конца ~{Math.ceil(displayedProgress.etaSeconds / 60)} мин
                            </span>
                        ) : null}
                    </div>

                    {progressPercent != null && (
                        <div
                            className={themeClass(theme, {
                                dark: 'h-1.5 overflow-hidden rounded bg-zinc-800/90',
                                light: 'h-1.5 overflow-hidden rounded bg-zinc-200',
                            })}
                        >
                            <div
                                className={themeClass(theme, {
                                    dark: 'h-full bg-violet-400 transition-all',
                                    light: 'h-full bg-violet-500 transition-all',
                                })}
                                style={{ width: `${progressPercent ?? 0}%` }}
                            />
                        </div>
                    )}

                    {progressCounters.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            {progressCounters.map(counter => (
                                <div
                                    key={counter.label}
                                    className={themeClass(theme, {
                                        dark: 'min-w-0 rounded-lg border border-zinc-700/70 bg-zinc-900/35 px-2.5 py-2',
                                        light: 'min-w-0 rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-2',
                                    })}
                                >
                                    <p
                                        className={themeClass(theme, {
                                            dark: 'truncate text-[11px] text-zinc-400',
                                            light: 'truncate text-[11px] text-zinc-500',
                                        })}
                                    >
                                        {counter.label}
                                    </p>
                                    <p
                                        className={themeClass(theme, {
                                            dark: 'truncate text-sm font-semibold text-zinc-100',
                                            light: 'truncate text-sm font-semibold text-zinc-900',
                                        })}
                                    >
                                        {counter.value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div className="space-y-1.5">
                        <p
                            className={themeClass(theme, {
                                dark: 'text-xs text-zinc-200',
                                light: 'text-xs text-zinc-700',
                            })}
                        >
                            {displayedProgress.statusMessage}
                        </p>
                        {displayedProgress.step && !isDuplicateProgressLine(displayedProgress.statusMessage, displayedProgress.step) ? (
                            <p className={themeClass(theme, { dark: 'text-xs text-zinc-400', light: 'text-xs text-zinc-600' })}>
                                Сейчас: {displayedProgress.step}
                            </p>
                        ) : null}
                    </div>

                    {displayedProgress.status === 'failed' && (
                        <p className="text-xs text-red-500">
                            Что пошло не так: {displayedProgress.errorReason ?? latestCityJob?.lastError ?? 'подробности в логе ниже'}
                        </p>
                    )}
                    {displayedProgress.status === 'completed' && (
                        <p className="text-xs text-emerald-500">
                            Готово: {displayedProgress.summary.collectedListings ?? displayedProgress.collectedListings ?? 0}{' '}
                            объявлений
                        </p>
                    )}
                    {canResumeCaptcha && latestCityJob ? (
                        <div className="pt-1">
                            <button
                                type="button"
                                className="rounded-xl border border-orange-500/40 px-3 py-1.5 text-xs text-orange-400"
                                onClick={() =>
                                    token &&
                                    void resumeParserCaptcha(token, latestCityJob.id).then(ok => {
                                        onToast(ok ? 'Сигнал продолжения отправлен' : 'Не удалось отправить продолжение');
                                        void refresh();
                                    })
                                }
                            >
                                Продолжить
                            </button>
                        </div>
                    ) : null}
                </div>
            )}
            {showLogTail && (
                <div
                    className={themeClass(theme, {
                        dark: 'mt-3 rounded-xl border border-zinc-700 bg-zinc-950',
                        light: 'mt-3 rounded-xl border border-zinc-300 bg-zinc-950',
                    })}
                >
                    <div
                        className={themeClass(theme, {
                            dark: 'border-b border-zinc-800 px-3 py-2 text-[11px] text-zinc-400',
                            light: 'border-b border-zinc-700 px-3 py-2 text-[11px] text-zinc-300',
                        })}
                    >
                        Логи парсера ({latestCityJob?.status})
                    </div>
                    <pre className="max-h-52 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-zinc-100 whitespace-pre-wrap break-words">
                        {logTail?.slice(-4000)}
                    </pre>
                </div>
            )}
            <div className="mt-4 min-w-0 border-t border-zinc-700/30 pt-3 dark:border-zinc-700">
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
                    {STAGES.map(s => (
                        <button
                            key={s.id}
                            type="button"
                            disabled={busy || activeJob?.status === 'running'}
                            onClick={() => void runStage(s.id)}
                            className={`${CONTROL_BUTTON_BASE} ${themeClass(theme, {
                                dark: 'border border-violet-500/30 bg-violet-500/5 text-violet-100 hover:bg-violet-500/10',
                                light: 'border border-violet-200 bg-white text-violet-900 hover:bg-violet-50',
                            })}`}
                        >
                            {s.label}
                        </button>
                    ))}
                    {runningForCurrentCity && (
                        <button
                            type="button"
                            onClick={() => token && void cancelParserJob(token, activeJob.id).then(() => refresh())}
                            className={`${CONTROL_BUTTON_BASE} border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/10`}
                        >
                            Остановить
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleIngest()}
                        className={`${CONTROL_BUTTON_BASE} ${themeClass(theme, {
                            dark: 'border border-emerald-500/30 bg-emerald-500/5 text-emerald-100 hover:bg-emerald-500/10',
                            light: 'border border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50',
                        })}`}
                    >
                        Загрузить итоговую таблицу на сервер
                    </button>
                    <div className="ml-auto flex min-w-0 items-center gap-2 max-lg:ml-0 max-lg:basis-full">
                        <label
                            className={`${CONTROL_TEXT} whitespace-nowrap ${themeClass(theme, {
                                dark: 'text-zinc-300',
                                light: 'text-zinc-700',
                            })}`}
                        >
                            Лимит квартир
                        </label>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={targetListingsInput}
                            onChange={e => setTargetListingsInput(e.target.value)}
                            placeholder="например, 500"
                            className={`${CONTROL_SELECT_BASE} min-w-0 w-full max-w-full sm:w-40 sm:max-w-40 ${themeClass(theme, {
                                dark: 'border border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500',
                                light: 'border border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400',
                            })}`}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

function statusBoxClasses(mode: 'dark' | 'light', status: ParserProgress['status'] | null): string {
    if (status === 'failed') {
        return mode === 'dark' ? 'border-red-500/40 bg-red-900/20' : 'border-red-300 bg-red-50';
    }
    if (status === 'captcha_required' || status === 'waiting_user') {
        return mode === 'dark' ? 'border-orange-500/40 bg-orange-900/15' : 'border-orange-300 bg-orange-50';
    }
    if (status === 'running') {
        return mode === 'dark' ? 'border-amber-500/40 bg-amber-900/15' : 'border-amber-300 bg-amber-50';
    }
    if (status === 'completed') {
        return mode === 'dark' ? 'border-emerald-500/40 bg-emerald-900/15' : 'border-emerald-300 bg-emerald-50';
    }
    if (status === 'cancelled') {
        return mode === 'dark' ? 'border-zinc-500/40 bg-zinc-800/40' : 'border-zinc-300 bg-zinc-50';
    }
    return mode === 'dark' ? 'border-zinc-700/40 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50/80';
}

function statusBadgeClasses(status: ParserProgress['status'] | null): string {
    const base = 'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
    if (status === 'captcha_required') return `${base} bg-orange-100 text-orange-700`;
    if (status === 'waiting_user') return `${base} bg-amber-100 text-amber-700`;
    if (status === 'failed') return `${base} bg-red-100 text-red-700`;
    if (status === 'running') return `${base} bg-amber-100 text-amber-700`;
    if (status === 'completed') return `${base} bg-emerald-100 text-emerald-700`;
    if (status === 'cancelled') return `${base} bg-zinc-200 text-zinc-700`;
    return `${base} bg-zinc-200 text-zinc-700`;
}

function fallbackProgress(stage: ParserStage): ParserProgress {
    return {
        stage,
        status: 'running',
        label: `Стадия ${stage}`,
        step: null,
        details: null,
        done: null,
        total: null,
        percent: 3,
        etaSeconds: null,
        targetListings: null,
        collectedListings: null,
        updatedAt: null,
        linksStats: null,
        detailsStats: null,
        pipelineStage: 'PREPARING_ENV',
        statusMessage: 'Запуск задачи парсинга',
        errorReason: null,
        summary: {
            collectedListings: null,
            targetListings: null,
            linksCollected: null,
            linksProcessed: null,
        },
    };
}

function formatProgressStatus(status: ParserProgress['status'] | null): string {
    if (status === 'captcha_required') return 'Нужна капча';
    if (status === 'waiting_user') return 'Ожидание пользователя';
    if (status === 'running') return 'В работе';
    if (status === 'completed') return 'Завершено';
    if (status === 'failed') return 'Ошибка';
    if (status === 'cancelled') return 'Остановлено';
    if (status === 'queued') return 'В очереди';
    return 'Статус';
}

function formatPipelineStage(stage: ParserProgress['pipelineStage']): string {
    if (stage === 'QUEUED') return 'В очереди';
    if (stage === 'PREPARING_ENV') return 'Подготовка окружения';
    if (stage === 'STARTING_BROWSER') return 'Запуск браузера';
    if (stage === 'COLLECTING_LINKS') return 'Сбор ссылок';
    if (stage === 'PARSING_DETAILS') return 'Парсинг карточек';
    if (stage === 'ETL_PROCESSING') return 'Подготовка итоговой таблицы';
    if (stage === 'SAVING_DATASET') return 'Сохранение данных';
    if (stage === 'COMPLETED') return 'Завершено';
    if (stage === 'FAILED') return 'Ошибка';
    if (stage === 'CANCELLED') return 'Остановлено';
    return stage;
}

function getDisplayPercent(progress: ParserProgress): number | null {
    if (progress.done != null && progress.total != null && progress.total > 0) {
        const raw = Math.round((progress.done / progress.total) * 100);
        return Math.max(0, Math.min(100, raw));
    }
    if (progress.percent == null || !Number.isFinite(progress.percent)) return null;
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
}

function formatProgressRatio(done: number | null, total: number | null): string | null {
    if (done == null && total == null) return null;
    if (done != null && total != null) return `${done}/${total}`;
    if (done != null) return `${done}`;
    return total != null ? `0/${total}` : null;
}

function isDuplicateProgressLine(primary: string | null, secondary: string): boolean {
    if (!primary) return false;
    const normalizedPrimary = primary.trim().toLowerCase();
    const normalizedSecondary = secondary.trim().toLowerCase();
    return normalizedPrimary === normalizedSecondary;
}

function formatStage(stage: ParserStage): string {
    if (stage === 'links') return 'Собрать ссылки';
    if (stage === 'details') return 'Собрать карточки';
    if (stage === 'flush') return 'Сохранить временные данные';
    if (stage === 'etl') return 'Подготовить итоговую таблицу';
    if (stage === 'pipeline') return 'Запустить весь процесс сразу';
    return stage;
}

function shouldShowEta(progress: ParserProgress): boolean {
    if (progress.status !== 'running') return false;
    if (progress.etaSeconds == null) return false;
    if (!Number.isFinite(progress.etaSeconds)) return false;
    return progress.etaSeconds > 0;
}

function toCounterValue(raw: unknown): number | null {
    if (raw == null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return value;
}

function buildProgressCounters(progress: ParserProgress): Array<{ label: string; value: string }> {
    const detailsSuccessful = toCounterValue(progress.detailsStats?.successful_parses);
    const detailsFailed = toCounterValue(progress.detailsStats?.failed_parses);
    const collected = progress.summary.collectedListings ?? progress.collectedListings;
    const processedLinks = progress.summary.linksProcessed ?? toCounterValue(progress.detailsStats?.processed_links);
    const linksCollected = progress.summary.linksCollected ?? toCounterValue(progress.linksStats?.total_links);
    const counters: Array<{ label: string; value: string }> = [];

    if (detailsSuccessful != null) counters.push({ label: 'Успешно', value: String(detailsSuccessful) });
    if (detailsFailed != null) counters.push({ label: 'С ошибкой', value: String(detailsFailed) });
    if (collected != null) counters.push({ label: 'Карточек', value: String(collected) });
    if (processedLinks != null) counters.push({ label: 'Ссылок проверено', value: String(processedLinks) });
    if (linksCollected != null) counters.push({ label: 'Ссылок найдено', value: String(linksCollected) });
    return counters;
}
