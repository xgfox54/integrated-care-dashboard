"use client";

import { useEffect } from "react";

import type { PageCode, TabCode } from "@/lib/usage/codes";
import { usagePage } from "@/lib/usage/track";

/** 서버에서 그리는 화면(데이터 출처, 이용통계 안내)의 조회를 알리는 표시기. 화면에는 아무것도 그리지 않는다. */
export function PageUsage({ page, tab }: { readonly page: PageCode; readonly tab: TabCode }) {
  useEffect(() => {
    usagePage(page, tab);
  }, [page, tab]);
  return null;
}

