import { OPERATION_API_BASE } from "./config.js";

export class CredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialsError";
  }
}

export class ApiError extends Error {
  constructor(status, data) {
    super(apiErrorMessage(status));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function apiErrorMessage(status) {
  const base = `Search API вернул ошибку ${status}`;
  if (status === 401 || status === 403) {
    return `${base}: нет доступа к Search API или указан не тот каталог — это чинит оператор`;
  }
  return base;
}

function isAbortError(err) {
  return err !== null && err !== undefined && err.name === "AbortError";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const DEFAULT_SLEEP = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class YandexClient {
  #regionsTreePromise;

  constructor(config, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? DEFAULT_SLEEP;
    this.retryBaseMs = options.retryBaseMs ?? 500;
  }

  async request(method, path, body, { base } = {}) {
    this.#ensureCredentials();
    const baseUrl = base ?? this.config.apiBase;
    const resolved = new URL(String(path), baseUrl);
    if (resolved.origin !== new URL(baseUrl).origin) {
      throw new Error(
        `path должен быть относительным путём API (чужой origin: ${resolved.origin})`,
      );
    }
    const url = resolved.toString();
    let attempt = 0;
    for (;;) {
      try {
        return await this.#requestOnce(method, url, body);
      } catch (err) {
        if (!this.#isRetryable(err) || attempt >= this.config.maxRetries) throw err;
        await this.sleep(this.#retryDelay(err, attempt));
        attempt += 1;
      }
    }
  }

  topRequests({ phrase, numPhrases, regions, devices }) {
    return this.request("POST", "v2/wordstat/topRequests", {
      phrase,
      numPhrases,
      regions,
      devices,
    });
  }

  dynamics({ phrase, period, fromDate, toDate, regions, devices }) {
    return this.request("POST", "v2/wordstat/dynamics", {
      phrase,
      period,
      fromDate,
      toDate,
      regions,
      devices,
    });
  }

  regions({ phrase, region, devices }) {
    return this.request("POST", "v2/wordstat/regions", { phrase, region, devices });
  }

  regionsTree() {
    if (this.#regionsTreePromise === undefined) {
      this.#regionsTreePromise = this.request("POST", "v2/wordstat/getRegionsTree", {}).catch(
        (err) => {
          this.#regionsTreePromise = undefined;
          throw err;
        },
      );
    }
    return this.#regionsTreePromise;
  }

  async webSearchSync({ query, searchType, page }) {
    const data = await this.request(
      "POST",
      "v2/web/search",
      this.#searchBody({ query, searchType, page }),
    );
    return { data };
  }

  async webSearchAsync({ query, searchType, page }) {
    const op = await this.request(
      "POST",
      "v2/web/searchAsync",
      this.#searchBody({ query, searchType, page }),
    );
    if (!op?.id) {
      throw new Error(`searchAsync: нет id операции (${JSON.stringify(op)})`);
    }
    return this.#pollOperation(op.id);
  }

  #searchBody({ query, searchType, page }) {
    return {
      query: { searchType, queryText: query, page: String(page) },
      responseFormat: "FORMAT_XML",
    };
  }

  async #pollOperation(operationId) {
    const deadline = Date.now() + this.config.webSearch.asyncTimeoutMs;
    let delay = Math.max(500, this.config.webSearch.asyncPollMs);
    for (;;) {
      if (Date.now() >= deadline) {
        throw new Error(
          `searchAsync превысил таймаут ${this.config.webSearch.asyncTimeoutMs}мс (операция ${operationId})`,
        );
      }
      await this.sleep(delay);
      const status = await this.request("GET", `operations/${operationId}`, undefined, {
        base: OPERATION_API_BASE,
      });
      if (status.done) {
        if (status.error) {
          throw new Error(
            `searchAsync операция ${operationId} завершилась ошибкой: ${JSON.stringify(status.error)}`,
          );
        }
        if (!status.response) {
          throw new Error(`searchAsync операция ${operationId} завершена, но response пустой`);
        }
        return { data: status.response, operationId };
      }
      delay = Math.min(Math.round(delay * 1.5), 15000);
    }
  }

  #ensureCredentials() {
    if (this.config.token) return;
    throw new CredentialsError(
      "Не задан YANDEX_API_KEY. Задайте его в переменных окружения и перезапустите сервер.",
    );
  }

  #buildInit(method, body, signal) {
    const headers = { Authorization: `Api-Key ${this.config.token}` };
    const init = { method, headers, signal };
    if (String(method).toUpperCase() === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ folderId: this.config.folderId, ...(body ?? {}) });
    }
    return init;
  }

  async #requestOnce(method, url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(url, this.#buildInit(method, body, controller.signal));
      const text = await response.text();
      const data = parseJson(text);
      if (!response.ok) {
        const err = new ApiError(response.status, data);
        const retryAfterRaw = response.headers.get("Retry-After");
        if (retryAfterRaw !== null) {
          const retryAfter = Number(retryAfterRaw);
          if (Number.isFinite(retryAfter) && retryAfter >= 0) {
            err.retryAfterMs = Math.min(retryAfter, 30) * 1000;
          }
        }
        throw err;
      }
      return data;
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(`Запрос превысил таймаут (${this.config.timeoutMs} мс)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  #isRetryable(err) {
    if (err instanceof ApiError) {
      return err.status === 429 || err.status >= 500;
    }
    return true;
  }

  #retryDelay(err, attempt) {
    if (err.retryAfterMs !== undefined) return err.retryAfterMs;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30000);
  }
}
