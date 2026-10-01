/**
 * Инструмент MCP `web_search`: поиск по индексу Яндекса.
 * Режим `async` (по умолчанию) ставит отложенный запрос и опрашивает
 * операцию, `sync` идёт напрямую, `auto` при сбое async падает в sync.
 * Разбор base64-XML выдачи живёт здесь же, без внешних зависимостей.
 */
import { Buffer } from "node:buffer";
import { z } from "zod";
import { READ_ONLY, fail, mapSearchType, ok } from "../format.js";

const MODES = ["async", "sync", "auto"];

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(html) {
  return html ? decodeXmlEntities(html.replace(/<[^>]+>/g, "")) : "";
}

/** Разбирает XML поисковой выдачи: заголовок, URL, домен и сниппет каждого документа. */
export function parseSearchXml(xml) {
  if (!xml) return { totalFound: 0, foundHuman: "", results: [] };

  const found = xml.match(/<found-human>([\s\S]*?)<\/found-human>/);
  const foundNum = xml.match(/<found[^>]*>(\d+)<\/found>/);
  const totalFound = foundNum ? Number(foundNum[1]) : 0;
  const foundHuman = found ? stripTags(found[1]).trim() : "";

  const results = [];
  const docRe = /<doc[^>]*>([\s\S]*?)<\/doc>/g;
  let match;
  let pos = 0;
  while ((match = docRe.exec(xml)) !== null) {
    pos += 1;
    const doc = match[1];
    const url = decodeXmlEntities(doc.match(/<url>([\s\S]*?)<\/url>/)?.[1] || "");
    const domain = decodeXmlEntities(doc.match(/<domain>([\s\S]*?)<\/domain>/)?.[1] || "");
    const title = stripTags(doc.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const headline = stripTags(doc.match(/<headline>([\s\S]*?)<\/headline>/)?.[1] || "");
    const passages = [];
    const passageRe = /<passage>([\s\S]*?)<\/passage>/g;
    let passageMatch;
    while ((passageMatch = passageRe.exec(doc)) !== null) {
      passages.push(stripTags(passageMatch[1]));
    }
    const snippet = headline || passages.join(" ") || "";
    results.push({ pos, url, domain, title, snippet });
  }

  return { totalFound, foundHuman, results };
}

/**
 * Выбирает режим как v1: `sync` напрямую; `async` падает в sync только при
 * `fallbackSync`; `auto` — всегда. Возвращает данные и фактический режим.
 */
async function search(client, params, mode, fallbackSync) {
  if (mode === "sync") {
    const { data } = await client.webSearchSync(params);
    return { data, mode: "sync", operationId: null };
  }

  try {
    const { data, operationId } = await client.webSearchAsync(params);
    return { data, mode: "async", operationId };
  } catch (err) {
    const allowFallback = mode === "auto" || (mode === "async" && fallbackSync === true);
    if (!allowFallback) throw err;
    const { data } = await client.webSearchSync(params);
    return { data, mode: "sync-fallback", operationId: null, asyncError: err.message };
  }
}

/** Markdown-ответ: найденное, страница, режим и документы со сниппетами. */
function formatSearch(query, page, parsed, result) {
  const lines = [
    `## Поиск Яндекса: «${query}»`,
    parsed.foundHuman || `Найдено: ~${parsed.totalFound.toLocaleString("ru-RU")}`,
    `Страница: ${page}`,
    `Режим: ${result.mode}${result.operationId ? ` (операция ${result.operationId})` : ""}`,
  ];
  if (result.asyncError) {
    lines.push(`Async-режим упал, сработал sync: ${result.asyncError}`);
  }
  lines.push("");

  for (const item of parsed.results) {
    lines.push(`**${item.pos}.** ${item.title}`);
    lines.push(`   ${item.url}`);
    if (item.snippet) lines.push(`   ${item.snippet}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function registerSearchTools(server, client, webSearchConfig = {}) {
  const defaultMode = MODES.includes(webSearchConfig.mode) ? webSearchConfig.mode : "async";
  const fallbackSync = webSearchConfig.fallbackSync === true;

  server.registerTool(
    "web_search",
    {
      title: "Поиск в Яндексе",
      description:
        "Поиск по индексу Яндекса: заголовок, ссылка и сниппет. По умолчанию отложенный запрос (async); sync — по явному mode, auto — с откатом на sync при сбое.",
      inputSchema: {
        query: z.string().min(1).describe("Поисковый запрос"),
        searchType: z
          .enum(["ru", "tr", "com"])
          .default("ru")
          .describe("Регион поиска: ru (Россия), tr (Турция), com (международный)"),
        page: z.number().int().min(0).max(100).default(0).describe("Номер страницы (0-100)"),
        mode: z
          .enum(MODES)
          .default(defaultMode)
          .describe("async — отложенный запрос, sync — сразу, auto — async с откатом на sync"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, searchType = "ru", page = 0, mode }) => {
      try {
        const resolvedMode = mode ?? defaultMode;
        const result = await search(
          client,
          { query, searchType: mapSearchType(searchType), page },
          resolvedMode,
          fallbackSync,
        );

        const xml = result.data?.rawData
          ? Buffer.from(result.data.rawData, "base64").toString("utf-8")
          : "";
        const parsed = parseSearchXml(xml);
        if (parsed.results.length === 0) return ok("Ничего не найдено.");

        return ok(formatSearch(query, page, parsed, result));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
