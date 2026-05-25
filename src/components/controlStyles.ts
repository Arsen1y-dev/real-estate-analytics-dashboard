export const CONTROL_TEXT = 'text-sm font-medium leading-5';

export const CONTROL_CHIP_BASE = `inline-flex h-11 min-w-0 shrink-0 items-center rounded-xl px-3 ${CONTROL_TEXT}`;

export const CONTROL_BUTTON_BASE =
    `inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-3 ${CONTROL_TEXT} transition ` +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-0 ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

export const CONTROL_SELECT_BASE =
    `h-11 rounded-xl px-3 ${CONTROL_TEXT} transition ` +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-0 ' +
    'disabled:cursor-not-allowed disabled:opacity-60';
