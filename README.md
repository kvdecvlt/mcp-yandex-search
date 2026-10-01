# mcp-yandex-search

MCP-сервер: статистика Яндекс Вордстата и поиск Яндекса через Yandex Search API.

## Быстрый старт

1. Получите API-ключ в AI Studio (сервисный аккаунт с ролью `search-api.webSearch.user` создаётся вместе с ключом).
2. Добавьте сервер в конфигурацию клиента: команда `npx -y mcp-yandex-search`, переменная `YANDEX_API_KEY`, транспорт `stdio`.

Claude Desktop и Cursor:

```json
{
  "mcpServers": {
    "yandex-search": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-search"],
      "env": {
        "YANDEX_API_KEY": "ваш_ключ"
      }
    }
  }
}
```

opencode (секция `mcp`, `"type": "local"`):

```json
{
  "mcp": {
    "yandex-search": {
      "type": "local",
      "command": ["npx", "-y", "mcp-yandex-search"],
      "env": {
        "YANDEX_API_KEY": "ваш_ключ"
      }
    }
  }
}
```

## Инструменты

| Инструмент                  | Что делает                           | Параметры                                                                  |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `wordstat_get_top`          | Топ и похожие запросы за 30 дней     | `phrase`, `numPhrases` (1..2000, 50), `regionIds`, `devices`               |
| `wordstat_get_dynamics`     | Динамика частоты                     | `phrase`, `period` (monthly), `fromDate`, `toDate`, `regionIds`, `devices` |
| `wordstat_get_regions`      | Распределение по регионам за 30 дней | `phrase`, `regionMode` (regions), `devices`                                |
| `wordstat_get_regions_tree` | Дерево регионов с ID                 | нет                                                                        |
| `web_search`                | Поиск по индексу Яндекса             | `query`, `searchType` (ru), `page` (0), `mode` (async)                     |
| `raw_request`               | POST к любому пути Wordstat API      | `path`, `body`                                                             |

`devices`: `all`, `desktop`, `phone`, `tablet`. `period`: `daily`, `weekly`, `monthly`. `regionMode`: `all`, `cities`, `regions`. `mode`: `async` (отложенный, по умолчанию), `sync`, `auto` (async с откатом в sync).

## Переменные окружения

| Переменная                    | По умолчанию                             | Смысл                                               |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `YANDEX_API_KEY`              | нет                                      | API-ключ Yandex Search API                          |
| `YANDEX_FOLDER_ID`            | нет                                      | ID каталога Yandex Cloud; ключам AI Studio не нужен |
| `YANDEX_API_BASE`             | `https://searchapi.api.cloud.yandex.net` | База API                                            |
| `YANDEX_TIMEOUT_MS`           | `60000`                                  | Таймаут одного запроса                              |
| `YANDEX_MAX_RETRIES`          | `3`                                      | Повторы при 429, 5xx, сети и таймауте               |
| `MCP_TRANSPORT`               | `stdio`                                  | `stdio` или `http`                                  |
| `MCP_PORT`                    | `3100`                                   | Порт HTTP-транспорта, есть `/health`                |
| `WEB_SEARCH_MODE`             | `async`                                  | Режим по умолчанию для `web_search`                 |
| `WEB_SEARCH_ASYNC_TIMEOUT_MS` | `600000`                                 | Лимит ожидания отложенного поиска                   |
| `WEB_SEARCH_ASYNC_POLL_MS`    | `2000`                                   | Начальный интервал опроса операции                  |
| `WEB_SEARCH_FALLBACK_SYNC`    | `0`                                      | Откат в sync при ошибке async                       |

## Поведение

- Один вызов на одну фразу, квота Search API общая на ключ.
- `wordstat_get_top` и `wordstat_get_regions` считают последние 30 дней; даты принимает только `wordstat_get_dynamics` и выравнивает их по периоду.
- `count` приходит int64-строками.
- Таймаут 60 с, до 3 повторов на 429, 5xx, сеть и таймаут, пауза учитывает `Retry-After`.
- Дерево регионов кешируется.
- `raw_request` ходит только по относительным путям API.
- 401/403: нет доступа к Search API или не тот каталог.
- Телеметрии нет.

## Разработка

```bash
npm ci
npm test
npm run format:check
```

CI: Node 20 и 22, тесты без сети.

## Лицензия

MIT
