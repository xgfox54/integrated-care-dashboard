import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { activeRevisions, lineSubtree, revisionDto, revisionOutline, REVISION_LIST_LIMIT } from "@/lib/fiscal/budget-documents";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const bad = (message: string) => Response.json({ error: "INVALID_BUDGET_DOCUMENT_QUERY", message }, { status: 400, headers });

// 공개 예산서(편성 단계 문서) 조회. 관리자가 승인·활성화한 단계만 읽는다.
//   ?entity=lofin:laf:…&year=2026 → 공개 단계 목록(?entities=a,b,… 여러 기관), &view=list → 선택 목록용 짧은 항목,
//   ?revision=brev-… → 개요(부서~세부사업)와 지방재정365 대조, &line=번호 → 그 세부사업 아래 전체.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const entity = (params.get("entity") ?? "").slice(0, 40);
  const entitiesText = params.get("entities");
  const entities = entitiesText === null ? null : entitiesText.split(",").map((id) => id.trim()).filter(Boolean);
  const listView = params.get("view") === "list";
  const year = (params.get("year") ?? "").slice(0, 4);
  const revision = (params.get("revision") ?? "").slice(0, 40);
  const line = params.get("line");
  if (entity && !/^lofin:laf:\d{1,12}$/.test(entity)) return bad("기관 ID가 올바르지 않습니다.");
  if (entities && (entities.length > 400 || entities.some((id) => !/^lofin:laf:\d{1,12}$/.test(id)))) return bad("기관 ID 목록이 올바르지 않습니다.");
  if (year && !/^\d{4}$/.test(year)) return bad("회계연도는 네 자리 숫자여야 합니다.");
  if (revision && !/^brev-[a-f0-9]{20}$/.test(revision)) return bad("편성 단계 ID가 올바르지 않습니다.");
  if (line !== null && !/^\d{1,6}$/.test(line)) return bad("행 번호가 올바르지 않습니다.");
  try {
    const db = getD1();
    if (revision) {
      const body = line !== null ? await lineSubtree(db, revision, Number(line)) : await revisionOutline(db, revision);
      if (!body) return Response.json({ error: "NOT_FOUND", message: "공개 중인 예산서 단계나 행을 찾지 못했습니다." }, { status: 404, headers });
      return Response.json(body, { headers });
    }
    const rows = await activeRevisions(db, { entityId: entity || undefined, entityIds: entities ?? undefined, year: year || undefined });
    const truncated = !entity && !entities && rows.length >= REVISION_LIST_LIMIT;
    const revisions = rows.map(revisionDto).map((revision) => listView ? {
      document_revision_id: revision.document_revision_id, title: revision.title, issuer: revision.issuer, fiscal_entity: revision.fiscal_entity,
      fiscal_year: revision.fiscal_year, stage_label: revision.stage_label,
    } : revision);
    return Response.json({ revisions, truncated }, { headers });
  } catch (error) {
    return errorResponse(error, { code: "BUDGET_DOCUMENT_READ_FAILED", message: "예산서 자료를 읽지 못했습니다.", status: 500, path: "/api/budget/documents" });
  }
}
