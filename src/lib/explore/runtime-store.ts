import { ExploreStore } from "./store.js";
import { DatabaseExploreStore } from "./database-store.js";
import { databasePool } from "../db/pool.js";
import { serverlessJobs } from "../jobs/config.js";

export function exploreStore(): ExploreStore {
  return serverlessJobs()
    ? new DatabaseExploreStore(databasePool())
    : new ExploreStore();
}
