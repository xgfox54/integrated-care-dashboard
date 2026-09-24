"use client";

import type { CatalogEntry } from "@/lib/welfare100/payload";
import styles from "./InstitutionDetail.module.css";

// Adapted from hosungseo/korea100 InstitutionSwitcher (MIT License).

// 이 배포에서는 next/link 이동이 동작하지 않아 일반 링크를 쓴다.
const CATALOG_HREF = ["", "welfare100#institutions"].join("/");

export default function InstitutionSwitcher({
  currentSlug,
  entries,
  groupLabel,
}: {
  currentSlug: string;
  entries: CatalogEntry[];
  groupLabel: string;
}) {
  const currentIndex = entries.findIndex((entry) => entry.slug === currentSlug);
  if (entries.length === 0 || currentIndex < 0) {
    return (
      <nav className={styles.switcher} aria-label="제도 선택">
        <span>제도 선택</span>
        <div className={styles.switcherCommands}>
          <a href={CATALOG_HREF}>
            <span aria-hidden="true">←</span> 복지제도 대장
          </a>
        </div>
      </nav>
    );
  }
  const previous = entries[(currentIndex - 1 + entries.length) % entries.length];
  const next = entries[(currentIndex + 1) % entries.length];

  return (
    <nav className={styles.switcher} aria-label="제도 선택">
      <span>{groupLabel}</span>
      <select
        value={currentSlug}
        aria-label={groupLabel + " 제도 선택"}
        // 이 배포에서는 next/link·useRouter 이동이 동작하지 않아 주소 이동으로 연다.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        onChange={(event) => window.location.assign("/welfare100/" + event.target.value)}
      >
        {entries.map((entry) => (
          <option value={entry.slug} key={entry.slug}>
            {entry.priority.toString().padStart(2, "0")} · {entry.name}
          </option>
        ))}
      </select>
      <div className={styles.switcherCommands}>
        <a href={"/welfare100/" + previous.slug} aria-label={"이전 제도: " + previous.name}>
          <span aria-hidden="true">←</span> 이전
        </a>
        <a href={"/welfare100/" + next.slug} aria-label={"다음 제도: " + next.name}>
          다음 <span aria-hidden="true">→</span>
        </a>
      </div>
      <strong>
        {currentIndex + 1}/{entries.length}
      </strong>
    </nav>
  );
}
