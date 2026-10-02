import { localDataService } from "@/db/local-data-server";
import { createLocalDataHttpHandlers } from "@/lib/local-data-http.mjs";
import { env } from "cloudflare:workers";

const localEnv = env as typeof env & { BARO_PUBLISH_LOCAL_TOKEN?: string };

const handlers = createLocalDataHttpHandlers({
  service: localDataService,
  accessToken: localEnv.BARO_PUBLISH_LOCAL_TOKEN ?? "",
});

export async function GET(request: Request) {
  return handlers.GET(request);
}

export async function PUT(request: Request) {
  return handlers.PUT(request);
}
