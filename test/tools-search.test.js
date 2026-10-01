import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY } from "../src/format.js";
import { parseSearchXml, registerSearchTools } from "../src/tools/search.js";
import { createCaptureServer } from "./helpers.js";

const XML = `<yandexsearch><response><found priority="all">123</found><found-human>Нашлось 123 ответа</found-human>
<results><grouping><group><doc><url>https://a.ru/1</url><domain>a.ru</domain><title>Заголовок &amp; Co</title>
<headline>Сниппет первый</headline></doc></group></grouping></results></response></yandexsearch>`;

const b64 = (value) => Buffer.from(value, "utf8").toString("base64");

const setup = (client, webSearchConfig = { mode: "async", fallbackSync: false }) => {
  const { server, tools } = createCaptureServer();
  registerSearchTools(server, client, webSearchConfig);
  return tools.get("web_search");
};

test("регистрирует web_search с русскими текстами и READ_ONLY", () => {
  const { server, tools } = createCaptureServer();
  registerSearchTools(server, {}, { mode: "async", fallbackSync: false });

  assert.deepEqual([...tools.keys()], ["web_search"]);
  const { config } = tools.get("web_search");
  assert.equal(typeof config.title, "string");
  assert.ok(config.title.length > 0);
  assert.equal(typeof config.description, "string");
  assert.ok(config.description.length > 0);
  assert.deepEqual(config.annotations, READ_ONLY);
});

test("парсер извлекает документы и раскодирует сущности", () => {
  const r = parseSearchXml(XML);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].title, "Заголовок & Co");
  assert.equal(r.results[0].url, "https://a.ru/1");
  assert.equal(r.results[0].domain, "a.ru");
  assert.equal(r.results[0].snippet, "Сниппет первый");
  assert.equal(r.results[0].pos, 1);
  assert.equal(r.totalFound, 123);
  assert.equal(r.foundHuman, "Нашлось 123 ответа");
});

test("пустая выдача не ломает парсер", () => {
  assert.deepEqual(parseSearchXml("").results, []);
});

test("snippet собирается из passages, если нет headline", () => {
  const xml = `<doc><url>https://b.ru</url><passage>Первый</passage><passage>второй</passage></doc>`;
  const r = parseSearchXml(xml);
  assert.equal(r.results[0].snippet, "Первый второй");
  assert.equal(r.results[0].title, "");
});

test("по умолчанию используется режим из конфига", async () => {
  const calls = [];
  const client = {
    webSearchAsync: async () => {
      calls.push("async");
      return { data: { rawData: b64(XML) }, operationId: "op1" };
    },
    webSearchSync: async () => assert.fail("sync не должен вызываться"),
  };
  const tool = setup(client, { mode: "async", fallbackSync: false });

  const r = await tool.handler({ query: "тест", searchType: "ru", page: 0 });

  assert.deepEqual(calls, ["async"]);
  assert.match(r.content[0].text, /Режим: async \(операция op1\)/);
  assert.match(r.content[0].text, /Заголовок & Co/);
  assert.equal(r.isError, undefined);
});

test("auto падает в sync при ошибке async", async () => {
  const calls = [];
  const client = {
    webSearchAsync: async () => {
      calls.push("async");
      throw new Error("таймаут операции");
    },
    webSearchSync: async () => {
      calls.push("sync");
      return { data: { rawData: b64(XML) } };
    },
  };
  const tool = setup(client, { mode: "async", fallbackSync: false });

  const r = await tool.handler({ query: "тест", mode: "auto" });

  assert.deepEqual(calls, ["async", "sync"]);
  assert.match(r.content[0].text, /Режим: sync-fallback/);
  assert.match(r.content[0].text, /Заголовок & Co/);
  assert.equal(r.isError, undefined);
});

test("async падает в sync только при fallbackSync", async () => {
  const calls = [];
  const client = {
    webSearchAsync: async () => {
      calls.push("async");
      throw new Error("нет квоты");
    },
    webSearchSync: async () => {
      calls.push("sync");
      return { data: { rawData: b64(XML) } };
    },
  };
  const tool = setup(client, { mode: "async", fallbackSync: true });

  const r = await tool.handler({ query: "тест", mode: "async" });

  assert.deepEqual(calls, ["async", "sync"]);
  assert.match(r.content[0].text, /Режим: sync-fallback/);
});

test("async без fallbackSync пробрасывает ошибку в isError", async () => {
  const client = {
    webSearchAsync: async () => {
      throw new Error("нет квоты");
    },
    webSearchSync: async () => assert.fail("sync не должен вызываться"),
  };
  const tool = setup(client, { mode: "async", fallbackSync: false });

  const r = await tool.handler({ query: "тест", mode: "async" });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Ошибка: /);
  assert.match(r.content[0].text, /нет квоты/);
});

test("sync вызывает sync-метод и маппит тип поиска", async () => {
  const calls = [];
  const client = {
    webSearchAsync: async () => assert.fail("async не должен вызываться"),
    webSearchSync: async (p) => {
      calls.push(p);
      return { data: { rawData: b64(XML) } };
    },
  };
  const tool = setup(client, { mode: "async", fallbackSync: false });

  const r = await tool.handler({ query: "тест", searchType: "com", page: 2, mode: "sync" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { query: "тест", searchType: "SEARCH_TYPE_COM", page: 2 });
  assert.match(r.content[0].text, /Режим: sync/);
  assert.match(r.content[0].text, /Страница: 2/);
});

test("пустой rawData даёт «Ничего не найдено» без ошибки", async () => {
  const client = { webSearchAsync: async () => ({ data: {}, operationId: "op1" }) };
  const tool = setup(client);

  const r = await tool.handler({ query: "тест" });

  assert.equal(r.content[0].text.trim(), "Ничего не найдено.");
  assert.equal(r.isError, undefined);
});

test("XML без документов даёт «Ничего не найдено»", async () => {
  const emptyXml = b64(`<yandexsearch><response><found>0</found></response></yandexsearch>`);
  const client = { webSearchAsync: async () => ({ data: { rawData: emptyXml } }) };
  const tool = setup(client);

  const r = await tool.handler({ query: "тест" });

  assert.equal(r.content[0].text.trim(), "Ничего не найдено.");
  assert.equal(r.isError, undefined);
});

test("схема не принимает мусор", () => {
  const { server, tools } = createCaptureServer();
  registerSearchTools(server, {}, { mode: "sync", fallbackSync: false });
  const schema = tools.get("web_search").config.inputSchema;

  assert.equal(schema.query.safeParse("").success, false);
  assert.equal(schema.query.safeParse("тест").success, true);
  assert.equal(schema.searchType.safeParse("tr").success, true);
  assert.equal(schema.searchType.safeParse("eu").success, false);
  assert.equal(schema.page.safeParse(101).success, false);
  assert.equal(schema.page.safeParse(0).success, true);
  assert.equal(schema.mode.safeParse("yearly").success, false);
  assert.equal(schema.mode.safeParse(undefined).data, "sync");
});
