type LogData = Record<string, unknown>;

function formatLog(level: string, event: string, data?: LogData) {
  return JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
}

export function log(event: string, data?: LogData) {
  console.log(formatLog("info", event, data));
}

export function warn(event: string, data?: LogData) {
  console.warn(formatLog("warn", event, data));
}

export function error(event: string, data?: LogData) {
  console.error(formatLog("error", event, data));
}
