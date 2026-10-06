import { PageUsage } from "@/components/usage/page-usage";
import { getD1 } from "@/lib/d1";
import { allDocumentFacts, documentEvidence, documentFactDto, latestKnowledgeRunId, type DocFactRow } from "@/lib/imports/public";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "문서 근거 사실 · 전국 통합돌봄 사업 총괄 대시보드",
  description: "관리자가 검토·승인해 반입한 지방자치단체 공고·안내 문서(HWP/HWPX)의 사업 항목과 근거 위치",
};

const LINK_CLASS = "font-bold text-primary underline underline-offset-4 hover:text-(--jeju-primary-hover)";

interface Program {
  readonly subjectId: string;
  readonly label: string;
  readonly region: string;
  readonly facts: ReturnType<typeof documentFactDto>[];
}

async function loadPrograms(): Promise<Program[] | null> {
  try {
    const db = getD1();
    const rows = await allDocumentFacts(db, null, await latestKnowledgeRunId(db));
    const proofs = await documentEvidence(db, rows);
    const programs = new Map<string, Program>();
    for (const row of rows as DocFactRow[]) {
      const program = programs.get(row.subject_id) ?? { subjectId: row.subject_id, label: row.subject_label, region: [row.subject_sido, row.subject_sigungu].filter(Boolean).join(" "), facts: [] };
      program.facts.push(documentFactDto(row, proofs.get(row.import_id + "|" + row.statement_id) ?? []));
      programs.set(row.subject_id, program);
    }
    return [...programs.values()];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}

export default async function DocumentsPage() {
  const programs = await loadPrograms();
  return (
    <main className="mx-auto max-w-[900px] space-y-4 px-4 py-6 sm:px-6">
      <PageUsage page="sources" tab="sources" />
      <div>
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">문서 근거 사실</h1>
        <p className="mt-2 text-(length:--jeju-text-base) text-muted-foreground">
          지방자치단체 공고·안내 문서(HWP·HWPX)를 로컬에서 파싱하고 사람이 원문과 대조한 항목만, 관리자가 해시를 확인해 승인한 뒤 공개합니다.
          각 항목의 근거 위치는 파싱 구조(문단·표 블록) 기준이며 실제 인쇄 쪽수를 확인한 값이 아닙니다. 문서에 없는 조건은 알 수 없으므로 신청 전에 담당 기관에 확인하세요.
        </p>
      </div>
      {programs === null ? <p role="status">문서 사실을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p> : null}
      {programs?.length === 0 ? <p role="status" className="rounded-lg border border-border bg-card p-4">아직 공개된 문서 사실이 없습니다.</p> : null}
      {programs?.map((program) => {
        const sources = [...new Map(program.facts.map((fact) => [fact.source.source_version_id, fact.source])).values()];
        return (
          <section key={program.subjectId} id={program.subjectId} className="scroll-mt-24 space-y-3 rounded-xl border border-border bg-card p-5" aria-label={program.label}>
            <div>
              <h2 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">{program.label}</h2>
              <p className="text-(length:--jeju-text-sm) text-muted-foreground">
                {program.region} · {program.subjectId.startsWith("service:") ? <a className={LINK_CLASS} href={"/wiki?service=" + encodeURIComponent(program.subjectId)}>통합돌봄 WIKI에서 보기</a> : "문서가 정의한 사업(보건복지부 사업안내 미수록)"}
              </p>
            </div>
            <dl className="divide-y divide-border">
              {program.facts.map((fact) => (
                <div key={fact.statement_id} className="grid gap-1 py-2 sm:grid-cols-[8rem_1fr]">
                  <dt className="font-bold text-muted-foreground">{fact.predicate_label}</dt>
                  <dd>
                    <p>{fact.value}{fact.unit ? " (" + fact.unit + ")" : ""}</p>
                    {fact.evidence.map((item) => (
                      <p key={item.evidence_id} className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
                        근거: “{item.quote}” · 블록 {item.block_id}{item.layout_page_start ? " · 레이아웃 " + item.layout_page_start + "쪽(인쇄 쪽수 미확인)" : ""}
                      </p>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rounded-lg bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">
              {sources.map((source) => (
                <p key={source.source_version_id}>
                  출처: {source.issuer} 「{source.title}」{source.document_number ? " " + source.document_number : ""} ·{" "}
                  {source.url ? <a className={LINK_CLASS} href={source.url} target="_blank" rel="noreferrer">원문<span className="sr-only">(새 창)</span></a> : "원문 주소 미확인"} ·
                  원문 버전 {source.source_version_id} · {source.format} · {source.parser} · 이용 범위: {source.rights_basis}
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
