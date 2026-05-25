import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_PROFILES, getCityProfile } from '../shared/cities';
import type { ParserStage } from '../shared/parserProgress';

export type { ParserStage } from '../shared/parserProgress';
export type ParserJobRunOptions = {
    targetListings?: number | null;
};

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PARSER_DIR = path.join(ROOT, 'parser');
const PARSER_VENV_DIR = path.join(PARSER_DIR, '.venv');
const PARSER_REQUIREMENTS_PATH = path.join(PARSER_DIR, 'requirements-parser.txt');
const ARTIFACT_KEYS = ['links_file', 'details_file', 'processed_file', 'details_stats_file', 'links_stats_file'] as const;
const CITY_URL_MARKERS: Record<string, string[]> = {
    moscow: ['/moskva/', '/moskva_i_moskovskaya_oblast/'],
    saratov: ['/saratov/'],
};
type ArtifactKey = (typeof ARTIFACT_KEYS)[number];
type ParserConfigRaw = Partial<Record<ArtifactKey, string>> & {
    city_id?: string;
    base_url?: string;
    base_urls?: unknown;
    search_segments_file?: string | null;
    runtime_status_file?: string;
    runtime_control_file?: string;
};
export type ParserConfigValidation = {
    cityId: string;
    configPath: string;
    ok: boolean;
    errors: string[];
    warnings: string[];
    segmentsCount: number | null;
};

function parserPythonCandidates(): string[] {
    const candidates = [
        process.env.PARSER_PYTHON,
        parserVenvPythonPath(),
        path.join(ROOT, '.venv', 'bin', 'python'),
        'python3',
        'python',
    ].filter(Boolean) as string[];
    return [...new Set(candidates)];
}

function parserVenvPythonPath(): string {
    if (process.platform === 'win32') return path.join(PARSER_VENV_DIR, 'Scripts', 'python.exe');
    return path.join(PARSER_VENV_DIR, 'bin', 'python');
}

function requiredModulesForStage(stage: ParserStage): string[] {
    if (stage === 'etl') return ['pandas'];
    if (stage === 'pipeline') return ['selenium', 'pandas'];
    return ['selenium'];
}

function checkPythonModules(pythonBin: string, modules: string[]): { ok: true } | { ok: false; error: string } {
    const result = spawnSync(
        pythonBin,
        ['-c', `import ${modules.join(',')}`],
        { cwd: PARSER_DIR, encoding: 'utf8' }
    );
    if (result.status === 0) return { ok: true };
    const stderr = (result.stderr ?? '').trim();
    const stdout = (result.stdout ?? '').trim();
    const details = stderr || stdout || `exit code ${result.status ?? 'null'}`;
    return { ok: false, error: details };
}

function runPythonCommand(
    pythonBin: string,
    args: string[],
    timeoutMs = 180_000
): { ok: true; stdout: string; stderr: string } | { ok: false; error: string } {
    const result = spawnSync(pythonBin, args, {
        cwd: PARSER_DIR,
        encoding: 'utf8',
        timeout: timeoutMs,
    });
    if (result.status === 0) {
        return {
            ok: true,
            stdout: (result.stdout ?? '').trim(),
            stderr: (result.stderr ?? '').trim(),
        };
    }
    const stderr = (result.stderr ?? '').trim();
    const stdout = (result.stdout ?? '').trim();
    const details = stderr || stdout || `exit code ${result.status ?? 'null'}`;
    return { ok: false, error: details };
}

function createParserVenv(basePython: string): { ok: true } | { ok: false; error: string } {
    const create = runPythonCommand(basePython, ['-m', 'venv', PARSER_VENV_DIR], 120_000);
    if (!create.ok) {
        return { ok: false, error: `Не удалось создать parser/.venv через ${basePython}: ${create.error}` };
    }
    return { ok: true };
}

function installParserRequirements(pythonBin: string): { ok: true } | { ok: false; error: string } {
    if (!fs.existsSync(PARSER_REQUIREMENTS_PATH)) {
        return { ok: false, error: `Не найден файл зависимостей: ${PARSER_REQUIREMENTS_PATH}` };
    }
    const install = runPythonCommand(
        pythonBin,
        ['-m', 'pip', 'install', '-r', PARSER_REQUIREMENTS_PATH],
        480_000
    );
    if (!install.ok) {
        return { ok: false, error: `pip install завершился с ошибкой: ${install.error}` };
    }
    return { ok: true };
}

function bootstrapParserDependencies(modules: string[]): { ok: true; pythonBin: string } | { ok: false; error: string } {
    const venvPython = parserVenvPythonPath();
    if (fs.existsSync(venvPython)) {
        const alreadyInstalled = checkPythonModules(venvPython, modules);
        if (alreadyInstalled.ok) return { ok: true, pythonBin: venvPython };
    } else {
        const bootstrapCandidate = parserPythonCandidates().find(candidate => {
            if (!candidate) return false;
            if (candidate === venvPython) return false;
            const probe = runPythonCommand(candidate, ['-c', 'import sys; print(sys.version_info[0])'], 20_000);
            return probe.ok;
        });
        if (!bootstrapCandidate) {
            return {
                ok: false,
                error:
                    'Не найден Python для bootstrap parser/.venv. Установите python3 или задайте PARSER_PYTHON перед запуском.',
            };
        }
        const created = createParserVenv(bootstrapCandidate);
        if (!created.ok) return created;
    }

    const installed = installParserRequirements(venvPython);
    if (!installed.ok) return installed;
    const checked = checkPythonModules(venvPython, modules);
    if (!checked.ok) {
        return {
            ok: false,
            error: `Зависимости установлены, но проверка import не прошла: ${checked.error}`,
        };
    }
    return { ok: true, pythonBin: venvPython };
}

function resolveParserPython(
    stage: ParserStage
): { ok: true; pythonBin: string; bootstrapped: boolean } | { ok: false; error: string } {
    const modules = requiredModulesForStage(stage);
    const attempts: string[] = [];
    for (const candidate of parserPythonCandidates()) {
        const check = checkPythonModules(candidate, modules);
        if (check.ok) return { ok: true, pythonBin: candidate, bootstrapped: false };
        attempts.push(`${candidate}: ${check.error}`);
    }
    const bootstrapped = bootstrapParserDependencies(modules);
    if (bootstrapped.ok) {
        return { ok: true, pythonBin: bootstrapped.pythonBin, bootstrapped: true };
    }
    return {
        ok: false,
        error: [
            `Не найден Python с зависимостями для стадии "${stage}" (нужны: ${modules.join(', ')}).`,
            'Проверен PARSER_PYTHON, parser/.venv и системные python.',
            `Авто-bootstrap parser/.venv тоже не удался: ${bootstrapped.error}`,
            `Ручная команда: python3 -m pip install -r "${PARSER_REQUIREMENTS_PATH}"`,
            attempts.length ? `Проверенные интерпретаторы:\n- ${attempts.join('\n- ')}` : '',
        ]
            .filter(Boolean)
            .join('\n'),
    };
}

const STAGE_MODULE: Record<ParserStage, string> = {
    links: 'pipeline.run_links',
    details: 'pipeline.run_details',
    etl: 'pipeline.etl',
    flush: 'pipeline.run_details',
    pipeline: 'pipeline.run_pipeline',
};

export function parserConfigAbsPath(cityId: string): string | null {
    const profile = getCityProfile(cityId);
    if (!profile) return null;
    return path.join(ROOT, profile.parserConfig);
}

function normalizeConfigPathForChecks(rawPath: string): string {
    return rawPath.replace(/\\/g, '/');
}

function hasExpectedCityMarker(url: string, cityId: string): boolean {
    const markers = CITY_URL_MARKERS[cityId] ?? [];
    return markers.length === 0 || markers.some(marker => url.includes(marker));
}

export function validateParserConfig(cityId: string): ParserConfigValidation {
    const configPath = parserConfigAbsPath(cityId) ?? '';
    const errors: string[] = [];
    const warnings: string[] = [];
    let segmentsCount: number | null = null;

    if (!configPath || !fs.existsSync(configPath)) {
        return {
            cityId,
            configPath,
            ok: false,
            errors: [`Конфиг не найден: ${configPath || '(пустой путь)'}`],
            warnings,
            segmentsCount,
        };
    }

    let raw: ParserConfigRaw;
    try {
        raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ParserConfigRaw;
    } catch (err) {
        return {
            cityId,
            configPath,
            ok: false,
            errors: [`Конфиг не читается как JSON: ${err instanceof Error ? err.message : String(err)}`],
            warnings,
            segmentsCount,
        };
    }

    if (raw.city_id && raw.city_id !== cityId) {
        errors.push(`city_id=${raw.city_id} не совпадает с cityId=${cityId}`);
    }

    const expectedPrefix = `data/${cityId}/`;
    for (const key of ARTIFACT_KEYS) {
        const rel = raw[key];
        if (!rel) continue;
        const normalized = normalizeConfigPathForChecks(rel);
        if (!normalized.startsWith(expectedPrefix)) {
            errors.push(`Поле ${key} должно начинаться с "${expectedPrefix}", сейчас: "${normalized}"`);
        }
    }

    if (raw.base_url && !hasExpectedCityMarker(raw.base_url, cityId)) {
        warnings.push(`base_url не содержит ожидаемый маркер города (${cityId}): ${raw.base_url}`);
    }

    if (Array.isArray(raw.base_urls)) {
        const wrongBaseUrls = raw.base_urls
            .filter((item): item is string => typeof item === 'string')
            .filter(item => !hasExpectedCityMarker(item, cityId));
        if (wrongBaseUrls.length > 0) {
            warnings.push(`base_urls содержит ${wrongBaseUrls.length} URL без маркера города`);
        }
    } else if (raw.base_urls != null) {
        warnings.push('base_urls задан, но не является массивом');
    }

    const segmentsFile = raw.search_segments_file;
    if (segmentsFile) {
        const absSegmentsPath = path.isAbsolute(segmentsFile)
            ? segmentsFile
            : path.resolve(path.dirname(configPath), segmentsFile);
        if (!fs.existsSync(absSegmentsPath)) {
            errors.push(`Файл search_segments_file не найден: ${absSegmentsPath}`);
        } else {
            try {
                const parsed = JSON.parse(fs.readFileSync(absSegmentsPath, 'utf8'));
                if (!Array.isArray(parsed)) {
                    errors.push(`Файл сегментов должен быть массивом URL: ${absSegmentsPath}`);
                } else {
                    const clean = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
                    segmentsCount = clean.length;
                    if (clean.length === 0) {
                        errors.push(`Файл сегментов пустой: ${absSegmentsPath}`);
                    }
                    const wrongSegments = clean.filter(url => !hasExpectedCityMarker(url, cityId));
                    if (wrongSegments.length > 0) {
                        warnings.push(`В сегментах ${wrongSegments.length} URL без маркера города (${cityId})`);
                    }
                }
            } catch (err) {
                errors.push(
                    `Не удалось прочитать search_segments_file (${absSegmentsPath}): ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
            }
        }
    } else {
        warnings.push('search_segments_file не указан');
    }

    return { cityId, configPath, ok: errors.length === 0, errors, warnings, segmentsCount };
}

export function validateAllParserConfigs(): ParserConfigValidation[] {
    return CITY_PROFILES.map(profile => validateParserConfig(profile.id));
}

export function processedCsvPath(cityId: string): string | null {
    const profile = getCityProfile(cityId);
    if (!profile) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(ROOT, profile.parserConfig), 'utf8')) as {
            processed_file?: string;
        };
        const rel = raw.processed_file ?? `data/${cityId}/processed_apartment_data.csv`;
        return path.join(PARSER_DIR, rel);
    } catch {
        return path.join(PARSER_DIR, 'data', cityId, 'processed_apartment_data.csv');
    }
}

export function statsPaths(cityId: string): {
    links?: string;
    details?: string;
    runtimeStatus?: string;
    runtimeControl?: string;
} {
    const profile = getCityProfile(cityId);
    if (!profile) return {};
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(ROOT, profile.parserConfig), 'utf8')) as {
            links_stats_file?: string;
            details_stats_file?: string;
            runtime_status_file?: string;
            runtime_control_file?: string;
        };
        return {
            links: raw.links_stats_file ? path.join(PARSER_DIR, raw.links_stats_file) : undefined,
            details: raw.details_stats_file ? path.join(PARSER_DIR, raw.details_stats_file) : undefined,
            runtimeStatus: path.join(PARSER_DIR, raw.runtime_status_file ?? 'pipeline/.runtime_status.json'),
            runtimeControl: path.join(PARSER_DIR, raw.runtime_control_file ?? 'pipeline/.runtime_control.json'),
        };
    } catch {
        return {};
    }
}

export function spawnParserJob(
    cityId: string,
    stage: ParserStage,
    logPath: string,
    options?: ParserJobRunOptions
): { child: ChildProcess; configPath: string } | { error: string } {
    const configPath = parserConfigAbsPath(cityId);
    if (!configPath || !fs.existsSync(configPath)) {
        return { error: `Конфиг парсера не найден для города ${cityId}` };
    }
    const preflight = validateParserConfig(cityId);
    if (!preflight.ok) {
        return {
            error: [
                `Preflight-конфиг не пройден для ${cityId}:`,
                ...preflight.errors.map(e => `- ${e}`),
                ...preflight.warnings.map(w => `- warning: ${w}`),
            ].join('\n'),
        };
    }

    const python = resolveParserPython(stage);
    if (!python.ok) return { error: python.error };

    const moduleName = STAGE_MODULE[stage];
    const args = ['-m', moduleName, '--config', configPath];
    if (stage === 'flush') {
        args.push('--flush-only');
    }
    const targetListings =
        options?.targetListings != null && options.targetListings > 0 ? Math.floor(options.targetListings) : null;
    if (targetListings != null && (stage === 'links' || stage === 'details' || stage === 'pipeline')) {
        args.push('--target-listings', String(targetListings));
    }

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn(python.pythonBin, args, {
        cwd: PARSER_DIR,
        env: {
            ...process.env,
            PYTHONPATH: [PARSER_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    if (python.bootstrapped) {
        fs.appendFileSync(logPath, `[parser-runner] parser/.venv bootstrap выполнен, используется ${python.pythonBin}\n`);
    }

    return { child, configPath };
}

export function preflightParserRuntime(
    stage: ParserStage = 'details'
): { ok: true; pythonBin: string; bootstrapped: boolean } | { ok: false; error: string } {
    const resolved = resolveParserPython(stage);
    if (!resolved.ok) return resolved;
    return { ok: true, pythonBin: resolved.pythonBin, bootstrapped: resolved.bootstrapped };
}

export function readJsonFileSafe<T>(filePath: string | undefined): T | null {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}
