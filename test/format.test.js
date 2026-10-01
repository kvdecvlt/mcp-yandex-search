import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_ONLY,
  alignDates,
  fail,
  formatDynamics,
  formatRegions,
  formatRegionsTree,
  formatTop,
  mapDevices,
  mapPeriod,
  mapRegionMode,
  mapSearchType,
  ok,
} from "../src/format.js";

test("маппинг перечислений", () => {
  assert.deepEqual(mapDevices(["all", "phone"]), ["DEVICE_ALL", "DEVICE_PHONE"]);
  assert.equal(mapPeriod("weekly"), "PERIOD_WEEKLY");
  assert.equal(mapRegionMode("cities"), "REGION_CITIES");
  assert.equal(mapSearchType("tr"), "SEARCH_TYPE_TR");
});

test("маппинг перечислений: крайние значения и дефолты", () => {
  assert.equal(mapDevices(undefined), undefined);
  assert.deepEqual(mapDevices([]), undefined);
  assert.equal(mapPeriod("daily"), "PERIOD_DAILY");
  assert.equal(mapPeriod("monthly"), "PERIOD_MONTHLY");
  assert.equal(mapPeriod(undefined), "PERIOD_MONTHLY");
  assert.equal(mapRegionMode("regions"), "REGION_REGIONS");
  assert.equal(mapRegionMode(undefined), "REGION_REGIONS");
  assert.equal(mapSearchType("com"), "SEARCH_TYPE_COM");
  assert.equal(mapSearchType(undefined), "SEARCH_TYPE_RU");
});

test("alignDates по периоду", () => {
  assert.deepEqual(alignDates("monthly", "2026-01-15T00:00:00Z", "2026-03-10T00:00:00Z"), {
    fromDate: "2026-01-01T00:00:00Z",
    toDate: "2026-03-31T00:00:00Z",
  });
  assert.deepEqual(alignDates("weekly", "2026-01-14T00:00:00Z", "2026-01-20T00:00:00Z"), {
    fromDate: "2026-01-12T00:00:00Z",
    toDate: "2026-01-25T00:00:00Z",
  });
  assert.deepEqual(alignDates("daily", "2026-01-14T00:00:00Z", "2026-01-20T00:00:00Z"), {
    fromDate: "2026-01-14T00:00:00Z",
    toDate: "2026-01-20T00:00:00Z",
  });
});

test("alignDates: границы месяца и воскресенье", () => {
  assert.deepEqual(alignDates("monthly", "2026-02-01T00:00:00Z", "2026-02-28T00:00:00Z"), {
    fromDate: "2026-02-01T00:00:00Z",
    toDate: "2026-02-28T00:00:00Z",
  });
  assert.deepEqual(alignDates("weekly", "2026-01-12T00:00:00Z", "2026-01-18T00:00:00Z"), {
    fromDate: "2026-01-12T00:00:00Z",
    toDate: "2026-01-18T00:00:00Z",
  });
});

test("вывод top: фраза, число, ru-локаль, int64-строки", () => {
  const text = formatTop("велосипед", {
    totalCount: "12345678",
    results: [{ phrase: "купить велосипед", count: "12345" }],
    associations: [],
  });
  assert.match(text, /велосипед/);
  assert.match(text, /купить велосипед/);
  assert.match(text, /12\s?345/);
  assert.ok(!text.includes("NaN"));
});

test("вывод top: нечисловое значение выводится как есть", () => {
  const text = formatTop("тест", {
    totalCount: "нет данных",
    results: [{ phrase: "запрос", count: "много" }],
    associations: [{ phrase: "похожий", count: "мало" }],
  });
  assert.match(text, /нет данных/);
  assert.match(text, /много/);
  assert.match(text, /мало/);
  assert.ok(!text.includes("NaN"));
});

test("вывод dynamics: таблица с датой и долей", () => {
  const text = formatDynamics(
    "велосипед",
    { fromDate: "2026-01-01T00:00:00Z", toDate: "2026-03-31T00:00:00Z", period: "PERIOD_MONTHLY" },
    {
      results: [
        { date: "2026-01-01T00:00:00Z", count: "1234", share: "0.5" },
        { date: "2026-02-01T00:00:00Z", count: "5678", share: "0.7" },
      ],
    },
  );
  assert.match(text, /велосипед/);
  assert.match(text, /2026-01-01/);
  assert.match(text, /1\s?234/);
  assert.match(text, /0,5/);
  assert.match(text, /Дата/);
  assert.match(text, /Доля/);
  assert.ok(!text.includes("NaN"));
});

test("вывод regions: регион, запросы, доля, индекс", () => {
  const text = formatRegions("велосипед", {
    results: [{ region: "213", count: "1234", share: "0.5", affinityIndex: "1.2" }],
  });
  assert.match(text, /велосипед/);
  assert.match(text, /Регион/);
  assert.match(text, /Запросы/);
  assert.match(text, /Доля/);
  assert.match(text, /Индекс/);
  assert.match(text, /213/);
  assert.match(text, /1\s?234/);
  assert.match(text, /0,5/);
  assert.match(text, /1,2/);
  assert.ok(!text.includes("NaN"));
});

test("вывод regions_tree: id, название, вложенность", () => {
  const text = formatRegionsTree({
    regions: [{ id: 1, label: "Россия", children: [{ id: 213, label: "Москва" }] }],
  });
  assert.match(text, /Россия/);
  assert.match(text, /\[213\] Москва/);
});

test("fail оборачивает ошибку и cause", () => {
  const err = new Error("boom", { cause: new Error("сеть отвалилась") });
  const result = fail(err);
  assert.equal(result.content[0].text, "Ошибка: boom (сеть отвалилась)");
  assert.equal(result.isError, true);
});

test("fail без cause", () => {
  const result = fail(new Error("boom"));
  assert.equal(result.content[0].text, "Ошибка: boom");
  assert.equal(result.isError, true);
});

test("ok отдаёт текст", () => {
  assert.deepEqual(ok("привет"), { content: [{ type: "text", text: "привет" }] });
});

test("READ_ONLY: все четыре флага", () => {
  assert.deepEqual(READ_ONLY, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
});
