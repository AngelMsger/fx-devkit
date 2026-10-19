// How long a lifecycle hook may take, in milliseconds. A different process enforces
// each limit, so the relations between them are stated here once.

// A supervisor waits this long for its worker before it reaps the worker's group.
export const FOREGROUND_SUPERVISOR_MS = 2000;
export const BACKGROUND_SUPERVISOR_MS = 30000;

// A worker stops lending time to companion commands this long before its supervisor
// would end it, which leaves room to record what the run finished.
const WORKER_HEADROOM_MS = 1000;
export const WORKER_BUDGET_MS = BACKGROUND_SUPERVISOR_MS - WORKER_HEADROOM_MS;

// One companion command never takes the whole budget: the phases after it still run.
export const COMPANION_COMMAND_MS = 15000;

// Session starts closer together than this share one background run.
export const SESSION_BURST_MS = 15000;
