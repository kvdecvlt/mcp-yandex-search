import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { ApiError, CredentialsError, YandexClient } from "../src/client.js";

const cfg = (over = {}) => ({
  ...loadConfig({ YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f" }),
  ...over,
});

const ok = (data = { ok: true }) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("без ключа бросает CredentialsError и не зовёт fetch", async () => {
  const client = new YandexClient(loadConfig({}), {
    fetchImpl: () => assert.fail("fetch не должен вызываться"),
  });
  await assert.rejects(client.request("POST", "v2/wordstat/topRequests", {}), CredentialsError);
});

test("успешный вызов: метод, заголовки, folderId", async () => {
  let seen;
  const client = new YandexClient(cfg(), {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return ok();
    },
  });
  const data = await client.request("POST", "v2/wordstat/topRequests", { phrase: "тест" });
  assert.deepEqual(data, { ok: true });
  assert.equal(seen.url, "https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests");
  assert.equal(seen.init.headers.Authorization, "Api-Key k");
  assert.deepEqual(JSON.parse(seen.init.body), { folderId: "f", phrase: "тест" });
});

test("без каталога запрос проходит, folderId не подставляется", async () => {
  let seen;
  const client = new YandexClient(loadConfig({ YANDEX_API_KEY: "k" }), {
    fetchImpl: async (url, init) => {
      seen = { init };
      return ok();
    },
  });
  await client.request("POST", "v2/wordstat/topRequests", { phrase: "тест" });
  assert.equal(seen.init.headers.Authorization, "Api-Key k");
  assert.deepEqual(JSON.parse(seen.init.body), { phrase: "тест" });
});

test("повтор на 500, затем успех", async () => {
  let calls = 0;
  const sleeps = [];
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response("err", { status: 500 }) : ok();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const data = await client.request("POST", "v2/wordstat/topRequests", {});
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
});

test("повтор на 429 с Retry-After", async () => {
  let calls = 0;
  const sleeps = [];
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limit", { status: 429, headers: { "Retry-After": "2" } })
        : ok();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const data = await client.request("POST", "v2/wordstat/topRequests", {});
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("без повтора на 400", async () => {
  let calls = 0;
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "bad" }), { status: 400 });
    },
    sleep: async () => assert.fail("sleep не должен вызываться"),
  });
  await assert.rejects(
    client.request("POST", "v2/wordstat/topRequests", {}),
    (err) => err instanceof ApiError && err.status === 400,
  );
  assert.equal(calls, 1);
});

test("401/403 получают пояснение про доступ и каталог", async () => {
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => new Response("denied", { status: 403 }),
  });
  await assert.rejects(
    client.request("POST", "v2/wordstat/topRequests", {}),
    /доступ к Search API|каталог/,
  );
});

test("сетевая ошибка повторяется и на пределе бросает", async () => {
  let calls = 0;
  const client = new YandexClient(cfg({ maxRetries: 1 }), {
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    },
    sleep: async () => {},
  });
  await assert.rejects(client.request("POST", "v2/wordstat/topRequests", {}), TypeError);
  assert.equal(calls, 2);
});

test("таймаут покрывает тело ответа", async () => {
  const client = new YandexClient(cfg({ timeoutMs: 20 }), {
    fetchImpl: (url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }),
      ),
  });
  await assert.rejects(client.request("POST", "v2/wordstat/topRequests", {}), /превысил таймаут/);
});

test("topRequests собирает тело и путь", async () => {
  let seen;
  const client = new YandexClient(cfg(), {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return ok();
    },
  });
  const data = await client.topRequests({
    phrase: "тест",
    numPhrases: 20,
    regions: ["213"],
    devices: ["DEVICE_ALL"],
  });
  assert.deepEqual(data, { ok: true });
  assert.equal(seen.url, "https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), {
    folderId: "f",
    phrase: "тест",
    numPhrases: 20,
    regions: ["213"],
    devices: ["DEVICE_ALL"],
  });
});

test("параллельные вызовы regionsTree дают один fetch", async () => {
  let calls = 0;
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => {
      calls++;
      return ok({ regions: [] });
    },
  });
  await Promise.all([client.regionsTree(), client.regionsTree()]);
  await client.regionsTree();
  assert.equal(calls, 1);
});

test("ошибка regionsTree не кешируется", async () => {
  let calls = 0;
  const client = new YandexClient(cfg({ maxRetries: 0 }), {
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response("err", { status: 500 }) : ok({ regions: [] });
    },
  });
  await assert.rejects(
    client.regionsTree(),
    (err) => err instanceof ApiError && err.status === 500,
  );
  assert.deepEqual(await client.regionsTree(), { regions: [] });
  assert.equal(calls, 2);
});

test("абсолютный URL и //host не уходят на чужой origin", async () => {
  const client = new YandexClient(cfg(), {
    fetchImpl: () => assert.fail("fetch не должен вызываться"),
  });
  await assert.rejects(client.request("POST", "https://evil.example/x", {}), /чужой origin/);
  await assert.rejects(client.request("POST", "//evil.example/x", {}), /чужой origin/);
});

test("webSearchAsync создаёт операцию и опрашивает её", async () => {
  const urls = [];
  const responses = [
    ok({ id: "op1" }),
    ok({ done: false }),
    ok({ done: true, response: { rawData: "abc" } }),
  ];
  const client = new YandexClient(cfg(), {
    fetchImpl: async (url) => {
      urls.push(url);
      return responses.shift();
    },
  });
  const r = await client.webSearchAsync({ query: "x", searchType: "SEARCH_TYPE_RU", page: 0 });
  assert.match(urls[0], /searchAsync$/);
  assert.match(urls[1], /operation\.api\.cloud\.yandex\.net\/operations\/op1/);
  assert.equal(urls.length, 3);
  assert.equal(r.operationId, "op1");
  assert.deepEqual(r.data, { rawData: "abc" });
});

test("операция с ошибкой бросает с её id", async () => {
  const responses = [ok({ id: "op1" }), ok({ done: true, error: { message: "boom" } })];
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => responses.shift(),
    sleep: async () => {},
  });
  await assert.rejects(
    client.webSearchAsync({ query: "x", searchType: "SEARCH_TYPE_RU", page: 0 }),
    /op1/,
  );
});

test("операция без response бросает", async () => {
  const responses = [ok({ id: "op1" }), ok({ done: true })];
  const client = new YandexClient(cfg(), {
    fetchImpl: async () => responses.shift(),
    sleep: async () => {},
  });
  await assert.rejects(
    client.webSearchAsync({ query: "x", searchType: "SEARCH_TYPE_RU", page: 0 }),
    /op1/,
  );
});
