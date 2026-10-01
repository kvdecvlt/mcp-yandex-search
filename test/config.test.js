import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_API_BASE, loadConfig } from "../src/config.js";

test("дефолты при пустом окружении", () => {
  const c = loadConfig({});
  assert.equal(c.token, undefined);
  assert.equal(c.folderId, undefined);
  assert.equal(c.apiBase, DEFAULT_API_BASE);
  assert.equal(c.timeoutMs, 60000);
  assert.equal(c.maxRetries, 3);
  assert.equal(c.transport, "stdio");
  assert.equal(c.port, 3100);
  assert.deepEqual(c.webSearch, {
    mode: "async",
    asyncTimeoutMs: 600000,
    asyncPollMs: 2000,
    fallbackSync: false,
  });
});

test("читает переменные и числа", () => {
  const c = loadConfig({
    YANDEX_API_KEY: "k",
    YANDEX_FOLDER_ID: "f",
    YANDEX_TIMEOUT_MS: "1500",
    YANDEX_MAX_RETRIES: "1",
    MCP_TRANSPORT: "http",
    MCP_PORT: "4100",
    WEB_SEARCH_MODE: "sync",
    WEB_SEARCH_FALLBACK_SYNC: "1",
  });
  assert.equal(c.token, "k");
  assert.equal(c.folderId, "f");
  assert.equal(c.timeoutMs, 1500);
  assert.equal(c.maxRetries, 1);
  assert.equal(c.transport, "http");
  assert.equal(c.port, 4100);
  assert.equal(c.webSearch.mode, "sync");
  assert.equal(c.webSearch.fallbackSync, true);
});

test("мусор падает в дефолты", () => {
  const c = loadConfig({
    YANDEX_TIMEOUT_MS: "abc",
    YANDEX_MAX_RETRIES: "-1",
    WEB_SEARCH_MODE: "bogus",
  });
  assert.equal(c.timeoutMs, 60000);
  assert.equal(c.maxRetries, 3);
  assert.equal(c.webSearch.mode, "async");
});
