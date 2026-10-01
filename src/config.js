export const DEFAULT_API_BASE = "https://searchapi.api.cloud.yandex.net";
export const OPERATION_API_BASE = "https://operation.api.cloud.yandex.net";

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_PORT = 3100;
const DEFAULT_ASYNC_TIMEOUT_MS = 600000;
const DEFAULT_ASYNC_POLL_MS = 2000;

const TRANSPORTS = new Set(["stdio", "http"]);
const WEB_SEARCH_MODES = new Set(["async", "sync", "auto"]);
const TRUE_VALUES = new Set(["1", "true", "yes"]);

/** Пустая строка равнозначна отсутствию значения. */
function raw(env, name) {
  const value = env[name];
  return value === undefined || value === null || value === "" ? undefined : value;
}

/** Необязательная строка. */
function optionalString(env, name) {
  return raw(env, name);
}

/** Строка с дефолтом. */
function stringOrDefault(env, name, fallback) {
  return raw(env, name) ?? fallback;
}

/** Целое число из окружения; невалидное или вне диапазона — дефолт. */
function intOrDefault(env, name, fallback, { min = 0, exclusiveMin = false } = {}) {
  const value = raw(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  if (exclusiveMin ? parsed <= min : parsed < min) return fallback;
  return parsed;
}

/** Значение из перечисления; всё прочее — дефолт. */
function enumOrDefault(env, name, allowed, fallback) {
  const value = raw(env, name);
  return value !== undefined && allowed.has(value) ? value : fallback;
}

/** Правдиво для `1`, `true`, `yes`. */
function boolOrDefault(env, name, fallback = false) {
  const value = raw(env, name);
  if (value === undefined) return fallback;
  return TRUE_VALUES.has(String(value).toLowerCase());
}

export function loadConfig(env = process.env) {
  return {
    token: optionalString(env, "YANDEX_API_KEY"),
    folderId: optionalString(env, "YANDEX_FOLDER_ID"),
    apiBase: stringOrDefault(env, "YANDEX_API_BASE", DEFAULT_API_BASE),
    timeoutMs: intOrDefault(env, "YANDEX_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, {
      min: 0,
      exclusiveMin: true,
    }),
    maxRetries: intOrDefault(env, "YANDEX_MAX_RETRIES", DEFAULT_MAX_RETRIES, { min: 0 }),
    transport: enumOrDefault(env, "MCP_TRANSPORT", TRANSPORTS, "stdio"),
    port: intOrDefault(env, "MCP_PORT", DEFAULT_PORT, { min: 0, exclusiveMin: true }),
    webSearch: {
      mode: enumOrDefault(env, "WEB_SEARCH_MODE", WEB_SEARCH_MODES, "async"),
      asyncTimeoutMs: intOrDefault(env, "WEB_SEARCH_ASYNC_TIMEOUT_MS", DEFAULT_ASYNC_TIMEOUT_MS, {
        min: 0,
        exclusiveMin: true,
      }),
      asyncPollMs: intOrDefault(env, "WEB_SEARCH_ASYNC_POLL_MS", DEFAULT_ASYNC_POLL_MS, {
        min: 0,
        exclusiveMin: true,
      }),
      fallbackSync: boolOrDefault(env, "WEB_SEARCH_FALLBACK_SYNC"),
    },
  };
}
