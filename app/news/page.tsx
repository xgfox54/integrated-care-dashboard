import type { Metadata } from "next";

import { PressBrowser } from "@/components/press/press-browser";
import { PageUsage } from "@/components/usage/page-usage";

export const metadata: Metadata = {
  title: "전국 복지뉴스 아카이빙 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "보건복지부와 지방행정기관이 공식 보도자료로 발표한 복지 소식의 제목·기관·게시일·원문 링크 모음입니다.",
};

export default function NewsPage() {
  return (
    <>
      <PressBrowser />
      <PageUsage page="news" tab="news" />
    </>
  );
}
