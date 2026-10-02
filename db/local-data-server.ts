import { getD1Database } from "./index";
import { createD1LocalDataRepository } from "./local-data-repository.mjs";
import { createLocalDataService } from "../lib/local-data-service.mjs";

const repository = createD1LocalDataRepository({ database: getD1Database() });

export const localDataService = createLocalDataService({ repository });
