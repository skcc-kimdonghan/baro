import { createServer } from "node:net";

export function assertLocalServerPortAvailable({ host = "127.0.0.1", port }) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        reject(new Error(`LOCAL_SERVER_ALREADY_RUNNING: ${host}:${port}`));
        return;
      }
      reject(error);
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}
