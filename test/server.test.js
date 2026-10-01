import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

const RESPONSE_TIMEOUT_MS = 15000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`таймаут ожидания: ${label}`)), RESPONSE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function startServer() {
  const env = { ...process.env };
  delete env.YANDEX_API_KEY;
  delete env.YANDEX_FOLDER_ID;

  const child = spawn(process.execPath, ["src/index.js"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const waiters = new Map();
  const stderrChunks = [];

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && waiters.has(message.id)) {
      waiters.get(message.id)(message);
      waiters.delete(message.id);
    }
  });
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  return {
    child,
    stderr: () => stderrChunks.join(""),
    waitForResponse(id) {
      return withTimeout(new Promise((resolve) => waiters.set(id, resolve)), `ответ id=${id}`);
    },
    send(message) {
      child.stdin.write(JSON.stringify(message) + "\n");
    },
  };
}

test("без ключей сервер стартует, объясняет настройку и отдаёт шесть инструментов", async (t) => {
  const server = startServer();
  t.after(() => server.child.kill());

  const initPromise = server.waitForResponse(1);
  server.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  });
  server.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const init = await initPromise;
  assert.match(init.result.instructions, /^ВНИМАНИЕ/);
  assert.match(init.result.instructions, /YANDEX_API_KEY/);
  assert.equal(init.result.serverInfo.name, "mcp-yandex-search");

  const toolsPromise = server.waitForResponse(2);
  server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = await toolsPromise;

  assert.deepEqual(tools.result.tools.map((tool) => tool.name).sort(), [
    "raw_request",
    "web_search",
    "wordstat_get_dynamics",
    "wordstat_get_regions",
    "wordstat_get_regions_tree",
    "wordstat_get_top",
  ]);

  assert.match(server.stderr(), /не заданы/);
});
