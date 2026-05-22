type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_PRIORITY) {
    return raw as LogLevel;
  }
  return "info";
}

const activeLevel = resolveLevel();
const activePriority = LEVEL_PRIORITY[activeLevel];

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: String(err) };
}

function emit(level: LogLevel, context: Record<string, unknown>, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < activePriority) {
    return;
  }

  const { err, ...rest } = fields ?? {};
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
    ...rest,
  };

  if (err !== undefined) {
    record.err = serializeError(err);
  }

  process.stderr.write(`${JSON.stringify(record)}\n`);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

function makeLogger(context: Record<string, unknown>): Logger {
  return {
    debug: (msg, fields) => emit("debug", context, msg, fields),
    info: (msg, fields) => emit("info", context, msg, fields),
    warn: (msg, fields) => emit("warn", context, msg, fields),
    error: (msg, fields) => emit("error", context, msg, fields),
    child: (extra) => makeLogger({ ...context, ...extra }),
  };
}

export const logger: Logger = makeLogger({});
