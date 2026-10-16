import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MindmapPage() {
  // 사용자 화면은 보류한다. 지도 구현·분류 자료·과거 이용통계는 복원을 위해 보존한다.
  notFound();
}
