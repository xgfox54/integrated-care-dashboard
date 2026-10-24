import { getD1 } from "../d1";
import { readCurrentStatisticsSnapshots } from "./store";

/** Server-rendered cards and the API/MCP use the same durable, validated publication. */
export async function loadCurrentStatisticsSnapshots(selectedId?: string) {
  return readCurrentStatisticsSnapshots(getD1(), Date.now(), selectedId);
}
