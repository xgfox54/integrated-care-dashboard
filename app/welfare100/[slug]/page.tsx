import type { Metadata } from "next";
import { Suspense } from "react";

import WelfareDetailLoader from "@/components/welfare100/WelfareDetailLoader";
import "@/components/welfare100/welfare100.css";
import programs from "@/data/welfare100/programs.json";

const curatedNames = new Map((programs as { slug: string; name: string }[]).map((program) => [program.slug, program.name]));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = curatedNames.get(decodeURIComponent(slug));
  return {
    title: name ? name + " | 복지제도100" : "복지제도 상세 | 복지제도100",
    description: "복지로 원문과 복지톡 DB 사업안내를 바탕으로 정리한 복지제도의 대상·급여·절차·법령 구조입니다.",
  };
}

export default async function Welfare100DetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="k100">
      <Suspense fallback={<div className="explorer-loading">업무구조도를 불러오는 중입니다.</div>}>
        <WelfareDetailLoader slug={decodeURIComponent(slug)} />
      </Suspense>
    </main>
  );
}

