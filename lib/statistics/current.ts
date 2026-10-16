import { getD1 } from "../d1";
import { readCurrentStatisticsSnapshots } from "./store";

/** Server-rendered cards and the API/MCP use the same durable, validated publication. */
export async function loadCurrentStatisticsSnapshots() {
  return readCurrentStatisticsSnapshots(getD1());
}
