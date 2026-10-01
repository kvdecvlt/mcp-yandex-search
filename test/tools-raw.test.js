import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY } from "../src/format.js";
import { registerRawTool } from "../src/tools/raw.js";
import { createCaptureServer } from "./helpers.js";

const setup = (client) => {
  const { server, tools } = createCaptureServer();
  registerRawTool(server, client);
  return tools.get("raw_request");
};

test("регистрирует raw_request с русскими текстами и READ_ONLY", () => {
  const { server, tools } = createCaptureServer();
  registerRawTool(server, {});

  assert.deepEqual([...tools.keys()], ["raw_request"]);
  const { config } = tools.get("raw_request");
  assert.equal(typeof config.title, "string");
  assert.ok(config.title.length > 0);
  assert.equal(typeof config.description, "string");
  assert.ok(config.description.length > 0);
  assert.deepEqual(config.annotations, READ_ONLY);
});

test("raw_request шлёт POST с телом и возвращает JSON", async () => {
  const calls = [];
  const data = { totalCount: "5", results: [{ phrase: "x" }] };
  const client = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return data;
    },
  };
  const tool = setup(client);

  const r = await tool.handler({ path: "v2/wordstat/topRequests", body: { phrase: "x" } });

  assert.deepEqual(calls, [
    { method: "POST", path: "v2/wordstat/topRequests", body: { phrase: "x" } },
  ]);
  assert.equal(r.content[0].text, JSON.stringify(data));
  assert.equal(r.isError, undefined);
});

test("raw_request без body шлёт POST без тела", async () => {
  const calls = [];
  const client = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return {};
    },
  };
  const tool = setup(client);

  const r = await tool.handler({ path: "v2/wordstat/getRegionsTree" });

  assert.deepEqual(calls, [
    { method: "POST", path: "v2/wordstat/getRegionsTree", body: undefined },
  ]);
  assert.equal(r.isError, undefined);
});

test("ошибка клиента превращается в isError", async () => {
  const client = {
    request: async () => {
      throw new Error("чужой origin");
    },
  };
  const tool = setup(client);

  const r = await tool.handler({ path: "v2/wordstat/topRequests" });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Ошибка: /);
  assert.match(r.content[0].text, /чужой origin/);
});

test("схема не пускает пустой path и не-объектный body", () => {
  const schema = setup({}).config.inputSchema;

  assert.equal(schema.path.safeParse("").success, false);
  assert.equal(schema.path.safeParse("v2/wordstat/topRequests").success, true);
  assert.equal(schema.body.safeParse({ phrase: "x" }).success, true);
  assert.equal(schema.body.safeParse(undefined).success, true);
  assert.equal(schema.body.safeParse("строка").success, false);
});
