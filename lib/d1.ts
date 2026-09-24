import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  const binding = (env as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error("데이터베이스 연결이 준비되지 않았습니다.");
  }
  return binding;
}
