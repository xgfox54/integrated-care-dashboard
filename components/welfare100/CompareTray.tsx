"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@/lib/welfare100/payload";
import styles from "./RegistryCatalog.module.css";

// Adapted from hosungseo/korea100 CompareTray (MIT License).

type InstitutionSummary = CatalogEntry;

interface CompareTrayProps {
  selected: InstitutionSummary[];
  onRemove: (slug: string) => void;
}

export default function CompareTray({ selected, onRemove }: CompareTrayProps) {
  const [open, setOpen] = useState(false);
  const canCompare = selected.length >= 2;

  if (selected.length === 0) return null;

  return (
    <>
      <aside className={styles.compareTray} aria-label="비교 선반">
        <strong>비교 선반</strong>
        <div className={styles.compareChips}>
          {selected.map((institution) => (
            <span key={institution.slug}>
              {institution.name}
              <button
                type="button"
                onClick={() => {
                  if (selected.length <= 2) setOpen(false);
                  onRemove(institution.slug);
                }}
                aria-label={`${institution.name} 비교에서 제외`}
                title="비교에서 제외"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <p>
          {canCompare
            ? `${selected.length}/3 선택됨`
            : "2개 이상 선택하면 비교할 수 있습니다"}
        </p>
        <button
          type="button"
          className={styles.compareOpenButton}
          disabled={!canCompare}
          onClick={() => setOpen(true)}
        >
          같은 기준으로 비교 <span aria-hidden="true">→</span>
        </button>
      </aside>

      {open && canCompare && (
        <CompareDialog selected={selected} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** 담당·법령 같은 칸은 전체 색인이 도착하면 채운다. */
function detail(item: InstitutionSummary, value: React.ReactNode): React.ReactNode {
  return item.complete ? value : "불러오는 중…";
}

function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getClientRects().length > 0);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1) ?? first;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function CompareDialog({
  selected,
  onClose,
}: {
  selected: InstitutionSummary[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab") {
        trapFocus(event, dialogRef.current);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const rows: Array<{
    label: string;
    render: (institution: InstitutionSummary) => React.ReactNode;
  }> = [
    { label: "구분 · 지역", render: (item) => (item.org === "중앙부처" ? "중앙부처" : [item.sido, item.sigungu].filter(Boolean).join(" ")) },
    { label: "분야 · 제공유형", render: (item) => `${item.category} · ${item.provision.join("·")}` },
    { label: "담당", render: (item) => detail(item, item.dept || "—") },
    { label: "절차 노드", render: (item) => item.processNodeCount },
    { label: "행위자 레인", render: (item) => detail(item, item.processLaneCount) },
    { label: "판단 게이트", render: (item) => detail(item, item.processGatewayCount) },
    { label: "근거 법령·지침", render: (item) => detail(item, `${item.legalBasisCount}건`) },
    { label: "복지톡 DB 원문", render: (item) => `${item.sourceCount}건` },
    { label: "핵심 병목", render: (item) => (item.curated ? detail(item, `${item.bottleneckCount}개`) : "주요 제도 100만 정리") },
    { label: "법령 · 규정", render: (item) => detail(item, item.laws.join(" · ") || "—") },
  ];

  return (
    <div className={styles.compareBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={styles.compareDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>같은 기준으로 비교</span>
            <h2 id="compare-title">선택한 {selected.length}개 제도의 구조 지표</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="비교 닫기">
            ×
          </button>
        </header>

        <div className={styles.compareTableScroll}>
          <table>
            <thead>
              <tr>
                <th scope="col">비교 기준</th>
                {selected.map((institution) => (
                  <th scope="col" key={institution.slug}>
                    <span>{institution.priority.toString().padStart(2, "0")}</span>
                    <a href={`/welfare100/${institution.slug}`}>
                      {institution.name}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {selected.map((institution) => (
                    <td key={institution.slug}>{row.render(institution)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
