import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const thisFile = fileURLToPath(import.meta.url);
const serverDir = path.dirname(thisFile);
const projectRoot = path.resolve(serverDir, '..');

type EnvSource =
    | 'project-root/.env'
    | 'project-root/.env.local'
    | 'fallback(cwd/.env)'
    | 'fallback(no-env-file)'
    | 'fallback(load-error)';

export type BootstrapEnvStatus = {
    source: EnvSource;
    loadedFrom: string | null;
    cwd: string;
    projectRoot: string;
};

const envCandidates: Array<{ source: EnvSource; envPath: string; override: boolean }> = [
    { source: 'project-root/.env', envPath: path.join(projectRoot, '.env'), override: false },
    { source: 'project-root/.env.local', envPath: path.join(projectRoot, '.env.local'), override: true },
    { source: 'fallback(cwd/.env)', envPath: path.resolve(process.cwd(), '.env'), override: false },
];

export const bootstrapEnvStatus: BootstrapEnvStatus = {
    source: 'fallback(no-env-file)',
    loadedFrom: null,
    cwd: process.cwd(),
    projectRoot,
};

const visited = new Set<string>();
for (const candidate of envCandidates) {
    const normalized = path.resolve(candidate.envPath);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    if (!fs.existsSync(normalized)) continue;
    const result = dotenv.config({ path: normalized, override: candidate.override });
    if (result.error) {
        bootstrapEnvStatus.source = 'fallback(load-error)';
        bootstrapEnvStatus.loadedFrom = normalized;
        continue;
    }
    bootstrapEnvStatus.source = candidate.source;
    bootstrapEnvStatus.loadedFrom = normalized;
}
