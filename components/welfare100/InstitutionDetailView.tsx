"use client";

import { useState, type CSSProperties } from "react";
import InstitutionSwitcher from "./InstitutionSwitcher";
import ProcessExplorer from "./ProcessExplorer";
import WelfareSearchBar from "./WelfareSearchBar";
import { buildProcessLaneGroups } from "@/lib/welfare100/process-layout.mjs";
import { formatProcessWarnings } from "@/lib/welfare100/process-warnings.mjs";
import { bokjiroUrl } from "@/lib/welfare100/bokjiro";
import type { BokjiroRaw, TalkRefOriginal } from "@/lib/welfare100/catalog-types";
import type { WelfareInstitution } from "@/lib/welfare100/model";
import { lawUrl } from "@/lib/welfare100/law-url";
import { manualReferenceEvidence, originalEvidenceNote, summarizeManualReferences } from "@/lib/welfare100/evidence-status";
import { provisionReviewFor } from "@/lib/welfare100/provision-review";
import { selectionFieldStatus } from "@/lib/welfare100/field-status";
import type { CatalogEntry } from "@/lib/welfare100/payload";
import { TOPIC_COLORS } from "@/lib/welfare100/topic-colors";
import { readableWelfareSummary, readableWelfareText } from "@/lib/welfare100/readable-text";
import styles from "./InstitutionDetail.module.css";

// Adapted from hosungseo/korea100 InstitutionDetailView (MIT License).

const TOPIC_SOURCE_NOTE: Record<WelfareInstitution["topicSource"], string> = {
  복지로: "복지로 관심주제",
  보정: "복지로 관심주제를 내용 기준으로 보정",
  추정: "복지로 관심주제가 없어 제도명·개요로 분류",
  편집: "복지톡 DB 원문 기준 편집 분류",
};

function originalPlace(original: TalkRefOriginal | undefined): string {
  if (!original) return "원본 쪽: 원본 파일에서 찾지 못했습니다.";
  if (original.basis === "document") return "원본 「" + original.file + "」 전체(" + original.pages + (original.format === "PDF" ? "쪽)" : "개 구역)");
  const span = original.pageEnd ? original.page + "~" + original.pageEnd : String(original.page);
  return "원본 「" + original.file + "」 " + (original.format === "PDF" ? span + "쪽" : "구역 " + span) + (original.basis === "context" ? " 부근" : "");
}


const compact = (value: string) => value.replace(/[\s·･ㆍ]/g, "");

function switcherGroup(institution: WelfareInstitution, catalog: CatalogEntry[]): { label: string; entries: CatalogEntry[] } {
  if (institution.analysis === "curated") return { label: "주요 제도 100", entries: catalog.filter((entry) => entry.curated) };
  if (institution.org === "중앙부처") return { label: "중앙부처 서비스", entries: catalog.filter((entry) => !entry.curated && entry.org === "중앙부처") };
  const label = institution.sigungu ? institution.sigungu + " 서비스" : institution.sido + " 서비스";
  return {
    label,
    entries: catalog.filter(
      (entry) => !entry.curated && entry.org === "지자체" && entry.sido === institution.sido && entry.sigungu === institution.sigungu,
    ),
  };
}

export default function InstitutionDetailView({
  institution,
  catalog,
}: {
  institution: WelfareInstitution;
  catalog: CatalogEntry[];
}) {
  const process = institution.process;
  const processWarnings = formatProcessWarnings(process?.warnings);
  const curated = institution.analysis === "curated";
  const manualSummary = summarizeManualReferences(institution.talkRefs, institution.name);
  const talkCount = manualSummary.total_reference_count;
  const linkSummaryText = "확정 연결 " + manualSummary.confirmed_reference_count + " · 후보 " + manualSummary.candidate_reference_count;
  const provisionReview = provisionReviewFor(institution.slug);
  const stats = [
    { value: process?.nodes.length ?? 0, label: "절차 노드" },
    { value: process?.lanes.length ?? 0, label: "행위 레인" },
    { value: process?.stages.length ?? 0, label: "단계" },
    { value: institution.canvas.legalBasis.length, label: "근거 법령·지침", accent: "verified" },
    curated
      ? { value: institution.canvas.bottlenecks.length, label: "병목 구간", accent: "warning" }
      : { value: talkCount, label: "연결 자료 구간", accent: "linked" },
  ];
  const group = switcherGroup(institution, catalog);
  const relatedSlugs = new Map<string, string>();
  for (const entry of catalog) if ((entry.curated || entry.org === "중앙부처") && !relatedSlugs.has(entry.name)) relatedSlugs.set(entry.name, entry.slug);
  const region = institution.org === "중앙부처" ? "중앙부처" : [institution.sido, institution.sigungu].filter(Boolean).join(" ");
  const primaryBokjiro = institution.bokjiro;

  return (
    <div className={styles.detail}>
      {/* 왼쪽: 전체 복지제도 통합검색, 오른쪽: 이 제도가 속한 묶음(지자체·중앙부처·주요 제도) 안에서 옮겨 다니기 */}
      <div className={styles.toolbar}>
        <WelfareSearchBar catalog={catalog} />
        <InstitutionSwitcher currentSlug={institution.slug} entries={group.entries} groupLabel={group.label} />
      </div>

      <section className={styles.titleBand}>
        <div className={styles.titleTop}>
          <div className={styles.titleCopy}>
            <div className={styles.titleMeta}>
              <span className={styles.priority}>NO {institution.priority.toString().padStart(2, "0")}</span>
              <span className={styles.category} style={{ "--category-color": TOPIC_COLORS[institution.category ?? ""] ?? "var(--jeju-text-muted)" } as CSSProperties}>{institution.category}</span>
              <span>{provisionReview ? provisionReview.recipientProvision.join("·") : institution.type}</span>
              <span>{region}</span>
              {curated ? (
                <span className={styles.verificationBadge} data-tone="linked">
                  <i aria-hidden="true" />
                  주요 제도 · {linkSummaryText}
                </span>
              ) : (
                <span className={styles.verificationBadge} data-tone={talkCount > 0 ? "linked" : "review"}>
                  <i aria-hidden="true" />
                  복지로 원문 · {linkSummaryText}
                </span>
              )}
              {primaryBokjiro?.edit && !curated ? (
                <span className={styles.verificationBadge} data-tone="verified">
                  <i aria-hidden="true" />
                  최신 자료 반영 {primaryBokjiro.edit.checkedAt}
                </span>
              ) : null}
            </div>
            <h1>{institution.name}</h1>
            <p>{readableWelfareSummary(institution.oneLiner)}</p>
          </div>

          <div className={styles.detailActions}>
            <a href={"/welfare100?compare=" + institution.slug + "#institutions"}>비교 선반에 담기</a>
            {primaryBokjiro && (
              <a href={bokjiroUrl(primaryBokjiro.id, primaryBokjiro.org)} target="_blank" rel="noreferrer">
                복지로에서 보기 ↗
              </a>
            )}
          </div>
        </div>

        <div className={styles.detailStats} aria-label="제도 구조 통계">
          {stats.map((stat) => (
            <div key={stat.label} data-accent={stat.accent}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="process" className={styles.processSection}>
        <header className={styles.sectionHeading}>
          <div>
            <h2>업무구조도</h2>
            <p>
              {curated
                ? "선행·설명 기준·후속·유의 단계는 제도 흐름의 편집 표기이며 실제 민원 처리상태가 아닙니다"
                : "복지로 처리절차에 등록된 단계별 담당기관으로 그린 흐름입니다. 노드 상태는 설명용입니다"}
            </p>
          </div>
          <div className={styles.legend} aria-label="노드 상태 범례">
            <span><i data-tone="done" />선행</span>
            <span><i data-tone="current" />설명 기준</span>
            <span><i data-tone="risk" />유의·재검토</span>
            <span><i data-tone="waiting" />후속</span>
          </div>
        </header>

        <div className={styles.processPanel}>
          {process ? (
            <ProcessExplorer
              process={process}
              verification={institution.verification}
              slug={institution.slug}
              laneGroups={buildProcessLaneGroups(process.lanes, institution.slug)}
            />
          ) : null}
        </div>

        {processWarnings.length > 0 && <p className={styles.processWarning}>{processWarnings.join(" / ")}</p>}
      </section>

      <OnePageCanvas institution={institution} relatedSlugs={relatedSlugs} />

      <footer className={styles.disclaimer}>
        <strong>근거:</strong> {institution.verification?.scope}
        <span>{institution.sources.join(" · ")}</span>
        <span>
          이 콘텐츠는 제도 이해를 위한 업무 참고 자료입니다. 실제 대상 여부와 지원 금액은 소관 기관의 최신 지침과 공식 안내를 확인하세요.
        </span>
      </footer>
    </div>
  );
}

function LongText({ text, lines = 10 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const readable = readableWelfareText(text);
  const rows = readable.split("\n");
  const long = rows.length > lines || readable.length > 700;
  if (!long) return <span className={styles.longText}>{readable}</span>;
  return (
    <span className={styles.longText}>
      {open ? readable : rows.slice(0, lines).join("\n").slice(0, 700) + " …"}
      <button type="button" className={styles.moreButton} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "접기" : "전체 보기"}
      </button>
    </span>
  );
}

function OnePageCanvas({
  institution,
  relatedSlugs,
}: {
  institution: WelfareInstitution;
  relatedSlugs: Map<string, string>;
}) {
  const { canvas, support } = institution;
  const curated = institution.analysis === "curated";
  const supportRows: [string, string | undefined][] = [
    ["지원 대상", support.target],
    ["선정 기준", support.selection],
    ["지원 내용", support.benefit],
    ["신청 방법", support.apply],
    ["문의", support.contact],
  ];
  const tags = [...institution.lifecycle, ...institution.household];

  return (
    <section id="institution-one-page" className={styles.canvasSection}>
      <header className={styles.sectionHeading}>
        <div>
          <h2>한 장 캔버스</h2>
          <p>대상 · 급여 · 법령 · 조직 · 절차 · 예산 · 문서</p>
        </div>
        <time dateTime={institution.asOfDate}>편집·수집 기준일 {institution.asOfDate}</time>
      </header>

      <div className={styles.canvasGrid}>
        <CanvasBlock title="지원 요약" size="wide">
          <p className={styles.mutedNote}>아래 금액·조건의 적용기간은 항목별 공식 근거를 확인해야 합니다. 편집·수집일은 최신성 검증일이 아닙니다.</p>
          {!support.selection?.trim() && <p className={styles.mutedNote}>{selectionFieldStatus(support.selection).note}</p>}
          <div className={styles.supportRows}>
            {supportRows
              .filter(([, value]) => Boolean(value && value.trim()))
              .map(([label, value]) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <LongText text={value as string} />
                </div>
              ))}
            {tags.length > 0 && (
              <div>
                <strong>생애주기·가구</strong>
                <span className={styles.longText}>{tags.join(" · ")}</span>
              </div>
            )}
          </div>
        </CanvasBlock>

        {provisionReviewFor(institution.slug) && (
          <CanvasBlock title="수혜자 제공유형 · 편집 분류" size="wide">
            <p>{provisionReviewFor(institution.slug)?.recipientProvision.join(" · ")}</p>
            <p>{provisionReviewFor(institution.slug)?.recipientDescription}</p>
            <p>{provisionReviewFor(institution.slug)?.providerSettlement}</p>
            <p className={styles.mutedNote}>{provisionReviewFor(institution.slug)?.basis} 분류 확인일: {provisionReviewFor(institution.slug)?.checkedAt}</p>
          </CanvasBlock>
        )}
        <CanvasBlock title="권한 관계">
          <div className={styles.authorityList}>
            {canvas.authorities.map((authority) => (
              <div key={authority.name}>
                <strong>{authority.name}</strong>
                <span>{authority.role}</span>
              </div>
            ))}
          </div>
        </CanvasBlock>

        <CanvasBlock title="목적과 법적 근거" size="wide">
          <p>{readableWelfareText(canvas.purpose)}</p>
          {canvas.legalBasis.length > 0 ? (
            <div className={styles.legalRows}>
              {canvas.legalBasis.map((basis) => {
                const url = basis.reviewNote ? undefined : basis.url ?? lawUrl(basis.law);
                return (
                  <div key={basis.kind + ":" + basis.law + ":" + (basis.articles ?? "")}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {basis.law}
                      </a>
                    ) : (
                      <strong>{basis.law}</strong>
                    )}
                    <span>{basis.articles?.replace(/,\s*(?=제\d)/g, ",\n") || "조문 미표기"}{basis.reviewNote && <><br /><small>{basis.reviewNote}</small></>}</span>
                    <small>{basis.kind}</small>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.mutedNote}>복지로에 등록된 근거 법령이 없습니다.</p>
          )}
        </CanvasBlock>

        <CanvasBlock title="관계자">
          <p>{readableWelfareText(canvas.stakeholders)}</p>
        </CanvasBlock>

        <CanvasBlock title="돈의 흐름">
          <p>{readableWelfareText(canvas.moneyFlow)}</p>
        </CanvasBlock>

        <CanvasBlock title="문서의 흐름">
          <p>{readableWelfareText(canvas.docsFlow)}</p>
        </CanvasBlock>

        {institution.bokjiro && <BokjiroBlock raw={institution.bokjiro} institution={institution} />}

        {canvas.bottlenecks.length > 0 && (
          <CanvasBlock title="업무상 유의점 · 편집자 해설" tone="warning">
            <p className={styles.mutedNote}>공식 조사·민원 통계로 검증된 현황이 아니라 제도 이해를 위한 검토 의견입니다.</p>
            <ul>
              {canvas.bottlenecks.map((item) => (
                <li key={item}>{readableWelfareText(item)}</li>
              ))}
            </ul>
          </CanvasBlock>
        )}

        {canvas.reformPoints.length > 0 && (
          <CanvasBlock title="개선 의견 · 편집자 해설" tone="accent" size="wide">
            <ul className={styles.twoColumnList}>
              {canvas.reformPoints.map((item) => (
                <li key={item}>{readableWelfareText(item)}</li>
              ))}
            </ul>
          </CanvasBlock>
        )}

        {(institution.related.length > 0 || institution.relatedServices.length > 0) && (
          <CanvasBlock title="관련 제도">
            <div className={styles.relatedLinks}>
              {institution.related.map((name) => {
                const slug = relatedSlugs.get(name);
                return slug ? (
                  <a href={"/welfare100/" + slug} key={"r:" + name}>
                    {name}
                  </a>
                ) : (
                  <span key={"r:" + name}>{name}</span>
                );
              })}
              {institution.relatedServices.map((service) => (
                <a href={"/welfare100/" + service.slug} key={"s:" + service.slug} data-kind="service">
                  {service.name}
                </a>
              ))}
            </div>
            {institution.relatedServices.length > 0 && <p className={styles.mutedNote}>복지로에 따로 등록된 세부 서비스를 함께 연결했습니다.</p>}
          </CanvasBlock>
        )}

        <CanvasBlock title="복지톡 DB 원문" size="wide" tone={institution.talkRefs.length > 0 ? "accent" : undefined}>
          {institution.talkRefs.length > 0 ? (
            <div className={styles.talkRefs}>
              <p className={styles.mutedNote}>
                연결 확정은 제도와 자료의 관계에 대한 판정입니다. 인용문 원본 대조·현재 적용기준 검증과는 다릅니다. 연결 건수는 자료 구간 기준입니다.
              </p>
              {institution.talkRefs.map((ref) => {
                const link = manualReferenceEvidence(ref, institution.name);
                const original = ref.original;
                const quote = original?.quote;
                const showHeading = original?.basis !== "document" && ref.heading && !(quote && compact(quote).startsWith(compact(ref.heading)));
                return (
                <article key={ref.key + ":" + ref.line}>
                  <header>
                    <strong>
                      [{ref.key}] {ref.title}
                    </strong>
                    <span>
                      {link.link_label + (link.link_confirmed ? " · 연결 확정" : " · 검토 후보")} · {ref.match}{ref.count > 1 ? " · 언급 " + ref.count + "회" : ""}
                    </span>
                  </header>
                  <p className={styles.talkRefPlace}>{originalPlace(original)}</p>
                  {showHeading && <em>{ref.heading}</em>}
                  {quote ? <blockquote>{quote}</blockquote> : original?.basis !== "document" && <p>{ref.excerpt}</p>}
                  <p className={styles.mutedNote}>
                    {originalEvidenceNote(original)} 연결 근거: {link.link_basis}{link.title_year_note ? " " + link.title_year_note : ""}
                  </p>
                </article>
                );
              })}
              <p className={styles.mutedNote}>쪽은 원본 PDF 파일의 쪽 순서(PDF 뷰어에 표시되는 쪽)이며, 문서에 인쇄된 쪽 번호와 다를 수 있습니다.</p>
            </div>
          ) : (
            <p className={styles.mutedNote}>
              {curated
                ? "이 제도는 위 근거 목록의 복지톡 DB 매뉴얼을 바탕으로 작성했습니다."
                : "복지톡 DB 사업안내 매뉴얼에서 이 제도명과 이어지는 원문을 찾지 못했습니다. 복지로 원문을 기준으로 정리했습니다."}
            </p>
          )}
        </CanvasBlock>

        <CanvasBlock title="현장 검증 필요" tone="field" size={curated ? "wide" : undefined}>
          <ul className={curated ? styles.twoColumnList : undefined}>
            {institution.fieldVerification.map((item) => (
              <li key={item}>{readableWelfareText(item)}</li>
            ))}
          </ul>
        </CanvasBlock>
      </div>
    </section>
  );
}

function BokjiroBlock({ raw, institution }: { raw: BokjiroRaw; institution: WelfareInstitution }) {
  const curated = institution.analysis === "curated";
  const rows: [string, React.ReactNode][] = [
    [
      "복지로 번호",
      <>
        {institution.bokjiroIds.map((id, index) => (
          <a key={id} href={bokjiroUrl(id, raw.org)} target="_blank" rel="noreferrer">
            {index > 0 ? " · " : ""}
            {id}
          </a>
        ))}
      </>,
    ],
    ["담당", raw.org === "중앙부처" ? [raw.inst, raw.dept].filter(Boolean).join(" ") : raw.dept ?? ""],
    ["복지로 원천 제공유형", raw.provision.join(" · ")],
    ["지원주기", raw.cycle.join(" · ")],
    ["신청방법", raw.applyMethods.join(" · ") + (raw.online ? " (복지로 온라인 신청 가능)" : "")],
    ["신청 주체", raw.applicants.join(" · ")],
    ["대상 연령", raw.ages ?? ""],
    ["시행", [raw.startDate, raw.endDate].filter(Boolean).join(" ~ ")],
    ["분야 분류", TOPIC_SOURCE_NOTE[institution.topicSource]],
    ["복지로 수정일", raw.updatedAt ?? ""],
  ];
  return (
    <CanvasBlock title="복지로 원문 정보" size={curated ? "wide" : undefined}>
      <dl className={styles.metaList}>
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        {raw.websites.length > 0 && (
          <div>
            <dt>관련 웹사이트</dt>
            <dd>
              {raw.websites.map((site, index) => (
                <a key={site.url + index} href={site.url} target="_blank" rel="noreferrer">
                  {index > 0 ? " · " : ""}
                  {site.name}
                </a>
              ))}
            </dd>
          </div>
        )}
        {raw.edit && !curated && (
          <div>
            <dt>최신 자료 반영</dt>
            <dd>
              {raw.edit.checkedAt} 확인. {raw.edit.note}
              {raw.edit.previousName ? " (복지로 등록 사업명: " + raw.edit.previousName + ")" : ""}
              <ul className={styles.editSources}>
                {raw.edit.sources.map((source, index) => (
                  <li key={source.url + index}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.label}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {curated && (
        <div className={styles.bokjiroOriginal}>
          {(
            [
              ["복지로 지원대상", raw.target],
              ["복지로 선정기준", raw.selection],
              ["복지로 지원내용", raw.benefit],
              ["복지로 신청방법", raw.applyText],
            ] as [string, string | undefined][]
          )
            .filter(([, value]) => Boolean(value))
            .map(([label, value]) => (
              <details key={label}>
                <summary>{label}</summary>
                <p className={styles.longText}>{value}</p>
              </details>
            ))}
        </div>
      )}
    </CanvasBlock>
  );
}

function CanvasBlock({
  title,
  tone,
  size,
  children,
}: {
  title: string;
  tone?: "warning" | "accent" | "field";
  size?: "wide";
  children: React.ReactNode;
}) {
  return (
    <article className={styles.canvasBlock} data-tone={tone} data-size={size}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}
