import { validateAllParserConfigs } from './parserRunner';

function main(): void {
    const results = validateAllParserConfigs();
    let hasErrors = false;

    for (const result of results) {
        const status = result.ok ? 'OK' : 'ERROR';
        const segmentNote = result.segmentsCount == null ? 'segments=n/a' : `segments=${result.segmentsCount}`;
        console.log(`[${status}] ${result.cityId} :: ${result.configPath} :: ${segmentNote}`);
        for (const warning of result.warnings) console.log(`  - warning: ${warning}`);
        for (const error of result.errors) console.log(`  - error: ${error}`);
        if (!result.ok) hasErrors = true;
    }

    if (hasErrors) {
        process.exitCode = 1;
        return;
    }
    console.log('Parser config validation passed for all cities.');
}

main();
