/**
 * Инструменты MCP для Яндекс Вордстата.
 * Регистрирует четыре инструмента поверх `YandexClient`: топ запросов,
 * динамика, распределение по регионам и дерево регионов. Схемы принимают
 * человекочитаемые значения (`monthly`, `all`, `cities`), а `format.js`
 * переводит их в wire-значения API.
 */
import { z } from "zod";
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
  ok,
} from "../format.js";

/** RFC3339 с обязательным временем и зоной. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const phraseSchema = z.string().min(1).describe("Ключевая фраза или запрос");
const numPhrasesSchema = z
  .number()
  .int()
  .min(1)
  .max(2000)
  .default(50)
  .describe("Сколько фраз вернуть (1-2000, по умолчанию 50)");
const regionIdsSchema = z
  .array(z.union([z.number().int(), z.string().regex(/^\d+$/)]))
  .optional()
  .describe("Идентификаторы регионов (числа или цифровые строки)");
const devicesSchema = z
  .array(z.enum(["all", "desktop", "phone", "tablet"]))
  .optional()
  .describe("Типы устройств");
const periodSchema = z
  .enum(["daily", "weekly", "monthly"])
  .default("monthly")
  .describe("Период агрегации");
const dateSchema = z.string().regex(DATE_RE).describe("Дата в формате RFC3339");
const regionModeSchema = z
  .enum(["all", "cities", "regions"])
  .default("regions")
  .describe("Разрез: все, города или регионы");

/** `[213, "1"]` → `["213", "1"]`; пусто → `undefined`. */
function regionIdsToWire(regionIds) {
  if (!Array.isArray(regionIds) || regionIds.length === 0) return undefined;
  return regionIds.map((id) => String(id));
}

export function registerWordstatTools(server, client) {
  server.registerTool(
    "wordstat_get_top",
    {
      title: "Топ запросов Вордстата",
      description:
        "Популярные и похожие запросы по ключевой фразе с числом показов за последние 30 дней.",
      inputSchema: {
        phrase: phraseSchema,
        numPhrases: numPhrasesSchema,
        regionIds: regionIdsSchema,
        devices: devicesSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ phrase, numPhrases = 50, regionIds, devices }) => {
      try {
        const data = await client.topRequests({
          phrase,
          numPhrases,
          regions: regionIdsToWire(regionIds),
          devices: mapDevices(devices),
        });
        return ok(formatTop(phrase, data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "wordstat_get_dynamics",
    {
      title: "Динамика запросов Вордстата",
      description:
        "Частотность запроса по месяцам, неделям или дням. Границы периода выравниваются по периоду.",
      inputSchema: {
        phrase: phraseSchema,
        period: periodSchema,
        fromDate: dateSchema,
        toDate: dateSchema,
        regionIds: regionIdsSchema,
        devices: devicesSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ phrase, period = "monthly", fromDate, toDate, regionIds, devices }) => {
      try {
        const mappedPeriod = mapPeriod(period);
        const range = { period: mappedPeriod, ...alignDates(period, fromDate, toDate) };
        const data = await client.dynamics({
          phrase,
          period: mappedPeriod,
          fromDate: range.fromDate,
          toDate: range.toDate,
          regions: regionIdsToWire(regionIds),
          devices: mapDevices(devices),
        });
        return ok(formatDynamics(phrase, range, data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "wordstat_get_regions",
    {
      title: "Регионы Вордстата",
      description:
        "Региональное распределение запросов: регион, число запросов, доля и индекс близости.",
      inputSchema: {
        phrase: phraseSchema,
        regionMode: regionModeSchema,
        devices: devicesSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ phrase, regionMode = "regions", devices }) => {
      try {
        const data = await client.regions({
          phrase,
          region: mapRegionMode(regionMode),
          devices: mapDevices(devices),
        });
        return ok(formatRegions(phrase, data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "wordstat_get_regions_tree",
    {
      title: "Дерево регионов Вордстата",
      description: "Дерево регионов Вордстата с идентификаторами и названиями.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const data = await client.regionsTree();
        return ok(formatRegionsTree(data));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
