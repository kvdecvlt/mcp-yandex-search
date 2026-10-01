/**
 * Вспомогательные функции для тестов инструментов.
 * `createCaptureServer` подменяет MCP-сервер: `registerTool` складывает
 * конфигурацию и обработчик в Map, чтобы тест мог вызвать их напрямую.
 */
export function createCaptureServer() {
  const tools = new Map();
  return {
    tools,
    server: { registerTool: (name, config, handler) => tools.set(name, { config, handler }) },
  };
}
