/**
 * Инструмент MCP `raw_request`: произвольный POST-запрос к Search API Яндекса.
 * `path` — относительный путь API, чужой origin блокируется в `YandexClient`,
 * `folderId` и авторизация подставляются клиентом автоматически.
 * Ответ возвращается как есть в виде JSON-строки.
 */
import { z } from "zod";
import { READ_ONLY, fail, ok } from "../format.js";

export function registerRawTool(server, client) {
  server.registerTool(
    "raw_request",
    {
      title: "Произвольный запрос к API",
      description:
        "POST-запрос к Search API Яндекса по относительному пути: например, v2/wordstat/topRequests. Чужой origin запрещён, folderId подставляется автоматически. Возвращает JSON-ответ API.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Относительный путь API, например v2/wordstat/topRequests"),
        body: z.record(z.unknown()).optional().describe("Тело POST-запроса (произвольный объект)"),
      },
      annotations: READ_ONLY,
    },
    async ({ path, body }) => {
      try {
        const data = await client.request("POST", path, body);
        return ok(JSON.stringify(data));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
