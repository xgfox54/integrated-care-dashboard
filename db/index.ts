import { drizzle } from "drizzle-orm/d1";
import { getD1 } from "../lib/d1";
import * as schema from "./schema";

export function getDb() {
  return drizzle(getD1(), { schema });
}
