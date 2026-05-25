export type ParserStage = 'links' | 'details' | 'etl' | 'flush' | 'pipeline';

export type ParserJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ParserProgressStatus = ParserJobStatus | 'captcha_required' | 'waiting_user';

export type ParserPipelineStage =
    | 'QUEUED'
    | 'PREPARING_ENV'
    | 'STARTING_BROWSER'
    | 'COLLECTING_LINKS'
    | 'PARSING_DETAILS'
    | 'ETL_PROCESSING'
    | 'SAVING_DATASET'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';

export type ParserProgressSummary = {
    collectedListings: number | null;
    targetListings: number | null;
    linksCollected: number | null;
    linksProcessed: number | null;
};

export type ParserProgress = {
    stage: ParserStage;
    status: ParserProgressStatus;
    label: string;
    step: string | null;
    details: string | null;
    done: number | null;
    total: number | null;
    percent: number | null;
    etaSeconds: number | null;
    targetListings: number | null;
    collectedListings: number | null;
    updatedAt: string | null;
    linksStats: Record<string, unknown> | null;
    detailsStats: Record<string, unknown> | null;
    pipelineStage: ParserPipelineStage;
    statusMessage: string;
    errorReason: string | null;
    summary: ParserProgressSummary;
};

export type ParserJob = {
    id: string;
    cityId: string;
    stage: ParserStage;
    status: ParserJobStatus;
    pid: number | null;
    configPath: string;
    logPath: string;
    startedAt: string;
    finishedAt: string | null;
    exitCode: number | null;
    lastError: string | null;
    targetListings: number | null;
};

export type ParserJobWithProgress = ParserJob & { progress: ParserProgress };
