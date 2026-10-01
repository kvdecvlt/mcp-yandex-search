/**
 * Нормализация параметров и Markdown-вывод ответов Yandex Search API.
 * Чистые функции без сетевых вызовов: сюда стягиваются маппинг перечислений,
 * выравнивание дат и форматирование для инструментов MCP.
 */

const DEVICE_MAP = {
  all: "DEVICE_ALL",
  desktop: "DEVICE_DESKTOP",
  phone: "DEVICE_PHONE",
  tablet: "DEVICE_TABLET",
};

const PERIOD_MAP = {
  daily: "PERIOD_DAILY",
  weekly: "PERIOD_WEEKLY",
  monthly: "PERIOD_MONTHLY",
};

const REGION_MODE_MAP = {
  all: "REGION_ALL",
  cities: "REGION_CITIES",
  regions: "REGION_REGIONS",
};

const SEARCH_TYPE_MAP = {
  ru: "SEARCH_TYPE_RU",
  tr: "SEARCH_TYPE_TR",
  com: "SEARCH_TYPE_COM",
};

/** Аннотации MCP: все инструменты только читают внешние данные. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** `["all", "phone"]` → `["DEVICE_ALL", "DEVICE_PHONE"]`; пусто → `undefined`. */
export function mapDevices(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return undefined;
  return devices.map((device) => DEVICE_MAP[device] ?? device);
}

/** `"weekly"` → `"PERIOD_WEEKLY"`; неизвестное → месячный период. */
export function mapPeriod(period) {
  return PERIOD_MAP[period] ?? "PERIOD_MONTHLY";
}

/** `"cities"` → `"REGION_CITIES"`; неизвестное → все регионы. */
export function mapRegionMode(mode) {
  return REGION_MODE_MAP[mode] ?? "REGION_REGIONS";
}

/** `"tr"` → `"SEARCH_TYPE_TR"`; неизвестное → русский поиск. */
export function mapSearchType(searchType) {
  return SEARCH_TYPE_MAP[searchType] ?? "SEARCH_TYPE_RU";
}

/** Дата в UTC, только дата, время всегда 00:00:00Z. */
function toIsoDay(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00Z`;
}

function parseIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Выравнивает границы периода в UTC: месяц к первому и последнему числу,
 * неделю к понедельнику и воскресенью, день оставляет как есть.
 */
export function alignDates(period, fromDate, toDate) {
  if (period === "daily") return { fromDate, toDate };

  const from = parseIso(fromDate);
  const to = parseIso(toDate);
  if (from === undefined || to === undefined) return { fromDate, toDate };

  if (period === "weekly") {
    const monday = new Date(from);
    monday.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
    const sunday = new Date(to);
    sunday.setUTCDate(to.getUTCDate() - ((to.getUTCDay() + 6) % 7) + 6);
    return { fromDate: toIsoDay(monday), toDate: toIsoDay(sunday) };
  }

  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
  return { fromDate: toIsoDay(first), toDate: toIsoDay(last) };
}

/** Число в русской локали; нечисловое значение возвращается как есть. */
function formatNumber(value) {
  if (value === undefined || value === null || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("ru-RU") : String(value);
}

function formatDate(value) {
  if (!value) return "—";
  return String(value).substring(0, 10);
}

/** Markdown-отчёт wordstat_get_top: топ и похожие запросы с числом. */
export function formatTop(phrase, data = {}) {
  const lines = [
    `## Вордстат: «${phrase}»`,
    `Всего запросов: ${formatNumber(data.totalCount)}`,
    "",
  ];

  if (data.results?.length) {
    lines.push(`### Топ-запросы (${data.results.length})`, "");
    for (const item of data.results) {
      lines.push(`- ${item.phrase} — ${formatNumber(item.count)}`);
    }
    lines.push("");
  }

  if (data.associations?.length) {
    lines.push(`### Похожие запросы (${data.associations.length})`, "");
    for (const item of data.associations) {
      lines.push(`- ${item.phrase} — ${formatNumber(item.count)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Markdown-таблица wordstat_get_dynamics: дата, запросы, доля. */
export function formatDynamics(phrase, range = {}, data = {}) {
  const lines = [`## Динамика: «${phrase}»`];
  if (range.period) lines.push(`Период: ${range.period}`);
  if (range.fromDate || range.toDate) {
    lines.push(`Границы: ${range.fromDate ?? "—"} — ${range.toDate ?? "—"}`);
  }
  lines.push("");

  if (data.results?.length) {
    lines.push("| Дата | Запросы | Доля |", "|------|---------|------|");
    for (const item of data.results) {
      lines.push(
        `| ${formatDate(item.date)} | ${formatNumber(item.count)} | ${formatNumber(item.share)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Markdown-таблица wordstat_get_regions: регион, запросы, доля, индекс близости. */
export function formatRegions(phrase, data = {}) {
  const lines = [`## Регионы: «${phrase}»`, ""];

  if (data.results?.length) {
    lines.push(
      "| Регион | Запросы | Доля | Индекс близости |",
      "|--------|---------|------|-----------------|",
    );
    for (const item of data.results) {
      lines.push(
        `| ${item.region} | ${formatNumber(item.count)} | ${formatNumber(item.share)} | ${formatNumber(item.affinityIndex)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function flattenRegions(regions, depth) {
  const lines = [];
  for (const region of regions) {
    lines.push(`${"  ".repeat(depth)}- [${region.id}] ${region.label}`);
    if (region.children?.length) {
      lines.push(...flattenRegions(region.children, depth + 1));
    }
  }
  return lines;
}

/** Markdown-дерево wordstat_get_regions_tree: ID и названия с вложенностью. */
export function formatRegionsTree(data = {}) {
  const lines = ["## Дерево регионов Вордстата", ""];
  if (data.regions?.length) {
    lines.push(...flattenRegions(data.regions, 0), "");
  }
  return lines.join("\n");
}

/** Успешный ответ инструмента MCP. */
export function ok(text) {
  return { content: [{ type: "text", text }] };
}

/** Ответ-ошибка инструмента MCP: текст «Ошибка: ...» и `isError: true`. */
export function fail(err) {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err?.cause;
  const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : "";
  const text = causeMessage ? `Ошибка: ${message} (${causeMessage})` : `Ошибка: ${message}`;
  return { content: [{ type: "text", text }], isError: true };
}
