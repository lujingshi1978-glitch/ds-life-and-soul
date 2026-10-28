import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { SnowLumaWebSocketClient } from "../packages/feiyu/src/onebot-client.js";
const require = createRequire(
  new URL("../packages/feiyu/package.json", import.meta.url),
);
const { WebSocketServer } = require("ws");
test("disabled OneBot makes no connection or request, including token refresh", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let connects = 0;
  server.on("connection", () => connects++);
  const client = new SnowLumaWebSocketClient({
    url: "ws://127.0.0.1:" + server.address().port,
    enabled: false,
    reconnect: true,
  });
  try {
    assert.deepEqual(await client.connect(), { disabled: true });
    await assert.rejects(
      client.raw("send_private_msg", { user_id: 100001, message: "fixture" }),
      { code: "ONEBOT_DISABLED" },
    );
    client.accessToken = "fixture-new-token";
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(connects, 0);
    assert.equal(client.connected, false);
  } finally {
    await client.close();
    await new Promise((r) => server.close(r));
  }
});
