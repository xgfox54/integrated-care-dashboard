"use client";

import { useEffect, useState } from "react";
import type { WelfareInstitution } from "@/lib/welfare100/model";
import { loadCatalog, loadInstitution, type CatalogEntry } from "@/lib/welfare100/payload";
import {
  newUsageId,
  takeUsageHandoff,
  usageEntityClose,
  usageEntityOpen,
  usageError,
  usageErrorCode,
  usagePage,
  usagePerf,
} from "@/lib/usage/track";
import InstitutionDetailView from "./InstitutionDetailView";

// 이 배포에서는 next/link 이동이 동작하지 않아 일반 링크를 쓴다.
const CATALOG_HREF = ["", "welfare100#institutions"].join("/");

type Result =
  | { status: "ready"; institution: WelfareInstitution; slug: string }
  | { status: "missing" }
  | { status: "error"; message: string };

export default function WelfareDetailLoader({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = slug + "#" + attempt;
  const [result, setResult] = useState<{ key: string; value: Result } | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const settle = (value: Result) => {
      if (!controller.signal.aborted) setResult({ key: requestKey, value });
    };
    const started = performance.now();
    loadInstitution(slug, controller.signal)
      .then((loaded) => {
        if (!loaded) {
          settle({ status: "missing" });
          usageError("welfare_detail", "not_found");
          return;
        }
        settle({ status: "ready", institution: loaded.institution, slug: loaded.canonicalSlug });
        usagePerf("welfare_detail", performance.now() - started);
        document.title = loaded.institution.name + " | 복지제도100";
        if (loaded.canonicalSlug !== slug) {
          window.history.replaceState(null, "", "/welfare100/" + loaded.canonicalSlug + window.location.search + window.location.hash);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        settle({ status: "error", message: reason instanceof Error ? reason.message : "제도 정보를 불러오지 못했습니다." });
        usageError("welfare_detail", usageErrorCode(reason));
      });
    return () => controller.abort();
  }, [slug, requestKey]);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((loaded) => {
        if (alive) setCatalog(loaded.entries);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const state = result && result.key === requestKey ? result.value : null;

  // 이용통계: 화면 조회와, 제도 상세가 실제로 표시됐을 때 열람 1회.
  useEffect(() => {
    usagePage("welfare_detail", "welfare100");
  }, []);
  const [viewId] = useState(() => newUsageId());
  const readySlug = state?.status === "ready" ? state.slug : "";
  useEffect(() => {
    if (!readySlug) return;
    const { route, search } = takeUsageHandoff("welfare_policy", [readySlug, slug]);
    usageEntityOpen(viewId, "welfare_policy", readySlug, route, search);
    return () => usageEntityClose(viewId);
  }, [readySlug, slug, viewId]);

  if (!state) return <div className="explorer-loading">업무구조도를 불러오는 중입니다.</div>;
  if (state.status === "ready") return <InstitutionDetailView institution={state.institution} catalog={catalog} />;
  return (
    <div className="explorer-loading" role="alert">
      <p>{state.status === "missing" ? "해당 복지제도를 찾을 수 없습니다." : state.message}</p>
      <p>
        {state.status === "error" && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 불러오기
          </button>
        )}{" "}
        <a href={CATALOG_HREF}>복지제도 대장으로</a>
      </p>
    </div>
  );
}
