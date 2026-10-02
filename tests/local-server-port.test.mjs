import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { assertLocalServerPortAvailable } from "../scripts/local-server-port.mjs";

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  return { server, port: address.port };
}

test("local startup port probe rejects an occupied loopback port", async (context) => {
  const { server, port } = await reserveLoopbackPort();
  context.after(() => server.close());

  await assert.rejects(
    assertLocalServerPortAvailable({ port }),
    /LOCAL_SERVER_ALREADY_RUNNING/,
  );
});

test("local startup port probe releases an available loopback port", async () => {
  const reservation = await reserveLoopbackPort();
  const { port } = reservation;
  await new Promise((resolve, reject) => reservation.server.close((error) => error ? reject(error) : resolve()));

  await assert.doesNotReject(assertLocalServerPortAvailable({ port }));
});
