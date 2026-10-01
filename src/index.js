#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { YandexClient } from "./client.js";
import { loadConfig } from "./config.js";
import { registerRawTool } from "./tools/raw.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWordstatTools } from "./tools/wordstat.js";

const INSTRUCTIONS =
  "Яндекс Вордстат — агрегированная статистика поискового спроса в поиске Яндекса: насколько часто " +
  "набирают фразу, когда и где. Плюс web_search по индексу Яндекса. Это не рекламный кабинет: " +
  "кампаний, ставок и расхода тут нет, данные не привязаны к аккаунту. Всё только на чтение. Один " +
  "вызов обрабатывает одну фразу, а квота Search API общая на ключ, поэтому не прогоняй списки " +
  "ключевых фраз вслепую и переиспользуй уже полученное. wordstat_get_top и wordstat_get_regions " +
  "всегда считают последние 30 дней; диапазон дат принимает только wordstat_get_dynamics (period " +
  "плюс границы). Значения count приходят int64-строками: перед сортировкой приводи их к числу. " +
  "Дерево регионов кешируется в процессе, перечитывать его бесплатно. Ошибки 429, 5xx и сбои сети " +
  "сервер уже повторяет сам, повторять тот же вызов бесполезно. 401/403 означает, что у ключа нет " +
  "доступа к Search API или YANDEX_FOLDER_ID указывает не на тот каталог, это чинит оператор. " +
  "web_search по умолчанию использует отложенные запросы и может отвечать долго; при необходимости " +
  "запроси mode=sync.";

const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: сервер ещё не настроен — не задан YANDEX_API_KEY, поэтому любой вызов инструмента " +
  "вернёт ошибку. Оператору нужно задать YANDEX_API_KEY (API-ключ Yandex Search API) в конфигурации " +
  "MCP-клиента и перезапустить сервер. Если ваша конфигурация ключа требует каталог, задайте ещё и " +
  "YANDEX_FOLDER_ID. ";

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main() {
  const config = loadConfig();
  const connected = Boolean(config.token);
  const client = new YandexClient(config);

  const server = new McpServer(
    { name: "mcp-yandex-search", version: readVersion() },
    { instructions: connected ? INSTRUCTIONS : UNCONFIGURED_PREFIX + INSTRUCTIONS },
  );

  registerWordstatTools(server, client);
  registerSearchTools(server, client, config.webSearch);
  registerRawTool(server, client);

  if (config.transport === "http") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const httpServer = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      await transport.handleRequest(req, res);
    });
    httpServer.listen(config.port, () => {
      console.error(`mcp-yandex-search работает на http://localhost:${config.port}/mcp`);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    connected
      ? "mcp-yandex-search работает на stdio"
      : "mcp-yandex-search работает на stdio (не заданы обязательные переменные: YANDEX_API_KEY — задайте и перезапустите сервер)",
  );
}

main().catch((error) => {
  console.error("Критическая ошибка при запуске mcp-yandex-search:", error);
  process.exit(1);
});
