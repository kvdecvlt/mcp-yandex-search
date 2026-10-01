import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY } from "../src/format.js";
import { registerWordstatTools } from "../src/tools/wordstat.js";
import { createCaptureServer } from "./helpers.js";

const NAMES = [
  "wordstat_get_top",
  "wordstat_get_dynamics",
  "wordstat_get_regions",
  "wordstat_get_regions_tree",
];

test("регистрирует 4 инструмента", () => {
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, {});

  assert.deepEqual([...tools.keys()], NAMES);
  for (const name of NAMES) {
    const { config } = tools.get(name);
    assert.equal(typeof config.title, "string", `${name}: title`);
    assert.ok(config.title.length > 0, `${name}: title непустой`);
    assert.equal(typeof config.description, "string", `${name}: description`);
    assert.ok(config.description.length > 0, `${name}: description непустой`);
    assert.deepEqual(config.annotations, READ_ONLY, `${name}: аннотации`);
    assert.equal(config.annotations.readOnlyHint, true, `${name}: readOnlyHint`);
  }
});

test("wordstat_get_top передаёт маппинг и возвращает Markdown", async () => {
  const calls = [];
  const client = {
    topRequests: async (p) => {
      calls.push(p);
      return { totalCount: "5", results: [{ phrase: "a", count: "3" }], associations: [] };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  const r = await tools
    .get("wordstat_get_top")
    .handler({ phrase: "тест", numPhrases: 50, devices: ["all"], regionIds: [213] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].phrase, "тест");
  assert.equal(calls[0].numPhrases, 50);
  assert.equal(calls[0].devices[0], "DEVICE_ALL");
  assert.deepEqual(calls[0].regions, ["213"]);
  assert.match(r.content[0].text, /тест/);
  assert.equal(r.isError, undefined);
});

test("wordstat_get_top: цифровые строки регионов и дефолтный numPhrases", async () => {
  const calls = [];
  const client = {
    topRequests: async (p) => {
      calls.push(p);
      return { totalCount: "0", results: [], associations: [] };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  await tools.get("wordstat_get_top").handler({ phrase: "тест", regionIds: ["213", 1] });

  assert.equal(calls[0].numPhrases, 50);
  assert.deepEqual(calls[0].regions, ["213", "1"]);
  assert.equal(calls[0].devices, undefined);
});

test("wordstat_get_dynamics выравнивает даты и маппит период", async () => {
  const calls = [];
  const client = {
    dynamics: async (p) => {
      calls.push(p);
      return { results: [{ date: "2026-01-01T00:00:00Z", count: "10", share: "0.5" }] };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  const r = await tools.get("wordstat_get_dynamics").handler({
    phrase: "тест",
    period: "monthly",
    fromDate: "2026-01-15T00:00:00Z",
    toDate: "2026-03-10T00:00:00Z",
    devices: ["phone"],
    regionIds: [213],
  });

  assert.equal(calls[0].period, "PERIOD_MONTHLY");
  assert.equal(calls[0].fromDate, "2026-01-01T00:00:00Z");
  assert.equal(calls[0].toDate, "2026-03-31T00:00:00Z");
  assert.deepEqual(calls[0].devices, ["DEVICE_PHONE"]);
  assert.deepEqual(calls[0].regions, ["213"]);
  assert.match(r.content[0].text, /Динамика/);
  assert.match(r.content[0].text, /2026-01-01/);
});

test("wordstat_get_regions маппит режим регионов и устройства", async () => {
  const calls = [];
  const client = {
    regions: async (p) => {
      calls.push(p);
      return {
        results: [{ region: "213", count: "10", share: "0.5", affinityIndex: "1.2" }],
      };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  const r = await tools
    .get("wordstat_get_regions")
    .handler({ phrase: "тест", regionMode: "cities", devices: ["desktop", "tablet"] });

  assert.equal(calls[0].phrase, "тест");
  assert.equal(calls[0].region, "REGION_CITIES");
  assert.deepEqual(calls[0].devices, ["DEVICE_DESKTOP", "DEVICE_TABLET"]);
  assert.match(r.content[0].text, /Регионы/);
});

test("wordstat_get_regions: дефолтный режим — регионы", async () => {
  const calls = [];
  const client = {
    regions: async (p) => {
      calls.push(p);
      return { results: [] };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  await tools.get("wordstat_get_regions").handler({ phrase: "тест" });

  assert.equal(calls[0].region, "REGION_REGIONS");
});

test("wordstat_get_regions_tree берёт дерево у клиента и форматирует", async () => {
  let times = 0;
  const client = {
    regionsTree: async () => {
      times += 1;
      return { regions: [{ id: 225, label: "Россия", children: [{ id: 213, label: "Москва" }] }] };
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  const r = await tools.get("wordstat_get_regions_tree").handler({});

  assert.equal(times, 1);
  assert.match(r.content[0].text, /Дерево регионов/);
  assert.match(r.content[0].text, /\[213\] Москва/);
});

test("ошибка клиента превращается в isError", async () => {
  const client = {
    topRequests: async () => {
      throw new Error("сеть отвалилась");
    },
  };
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, client);

  const r = await tools.get("wordstat_get_top").handler({ phrase: "тест" });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Ошибка: /);
});

test("схема не принимает мусор", () => {
  const { server, tools } = createCaptureServer();
  registerWordstatTools(server, {});

  const top = tools.get("wordstat_get_top").config.inputSchema;
  assert.equal(top.phrase.safeParse("").success, false);
  assert.equal(top.phrase.safeParse("тест").success, true);
  assert.equal(top.numPhrases.safeParse(0).success, false);
  assert.equal(top.numPhrases.safeParse(2001).success, false);
  assert.equal(top.numPhrases.safeParse(50).success, true);
  assert.equal(top.regionIds.safeParse(["abc"]).success, false);
  assert.equal(top.regionIds.safeParse([213, "1"]).success, true);
  assert.equal(top.devices.safeParse(["phone"]).success, true);
  assert.equal(top.devices.safeParse(["watch"]).success, false);

  const dynamics = tools.get("wordstat_get_dynamics").config.inputSchema;
  assert.equal(dynamics.fromDate.safeParse("nope").success, false);
  assert.equal(dynamics.fromDate.safeParse("2026-01-01T00:00:00Z").success, true);
  assert.equal(dynamics.fromDate.safeParse("2026-01-01T00:00:00+03:00").success, true);
  assert.equal(dynamics.period.safeParse("yearly").success, false);
  assert.equal(dynamics.period.safeParse("weekly").success, true);

  const regions = tools.get("wordstat_get_regions").config.inputSchema;
  assert.equal(regions.regionMode.safeParse("cities").success, true);
  assert.equal(regions.regionMode.safeParse("districts").success, false);
});
