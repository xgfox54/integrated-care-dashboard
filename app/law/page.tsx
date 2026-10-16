import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LawPage() {
  // 사용자 화면은 숨기고 같은 Worker의 /api/law와 MCP 법령 도구는 유지한다.
  notFound();
}
