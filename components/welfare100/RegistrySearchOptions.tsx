"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, CloseIcon, FilterIcon } from "@/components/ui/jeju-icons";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CatalogRegions } from "@/lib/welfare100/regions";
import styles from "./RegistrySearchTools.module.css";

const SCOPES = ["전체", "주요 제도", "중앙부처", "지자체"] as const;
export interface RegistrySearchFilters {
  readonly scope: (typeof SCOPES)[number];
  readonly sido: string;
  readonly sigungu: string;
  readonly category: string;
  readonly lifecycle: string;
  readonly household: string;
  readonly provision: string;
}
export const REGISTRY_FILTER_DEFAULTS = {
  scope: "전체", sido: "전체 시도", sigungu: "시도 전체", category: "전체",
  lifecycle: "전체", household: "전체", provision: "전체 제공유형",
} as const satisfies RegistrySearchFilters;

interface RegistrySearchOptionsProps {
  readonly filters: RegistrySearchFilters;
  readonly regions: CatalogRegions;
  readonly categories: readonly string[];
  readonly lifecycles: readonly string[];
  readonly households: readonly string[];
  readonly provisions: readonly string[];
  readonly onChange: (patch: Partial<RegistrySearchFilters>) => void;
}

export function RegistrySearchOptions({ filters, regions, categories, lifecycles, households, provisions, onChange }: RegistrySearchOptionsProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const filterKeys = ["scope", "sido", "sigungu", "category", "lifecycle", "household", "provision"] as const;
  const activeCount = filterKeys.filter((key) => filters[key] !== REGISTRY_FILTER_DEFAULTS[key]).length;
  const fields = [
    { key: "category", label: "분야 · 관심주제", all: "전체", values: categories },
    { key: "lifecycle", label: "생애주기", all: "전체", values: lifecycles },
    { key: "household", label: "가구상황", all: "전체", values: households },
    { key: "provision", label: "제공유형", all: "전체 제공유형", values: provisions },
  ] as const;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className={styles.optionsTrigger}>
          <FilterIcon />검색 옵션{activeCount > 0 ? ` (${activeCount})` : ""}<ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={16} className={styles.panel} aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className={styles.heading}>
          <strong id={titleId}>검색 옵션</strong>
          <Button type="button" variant="ghost" size="icon" aria-label="검색 옵션 닫기" onClick={() => setOpen(false)}><CloseIcon /></Button>
        </div>
        <p id={descriptionId} className={styles.notice}>조건을 선택하면 검색 결과에 바로 반영됩니다.</p>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>구분</span>
            <NativeSelect className={styles.select} value={filters.scope} onChange={(event) => {
              const scope = SCOPES.find((value) => value === event.target.value);
              if (scope) onChange({ scope });
            }}>
              {SCOPES.map((value) => <option key={value} value={value}>{value === "주요 제도" ? "주요 제도 100" : value}</option>)}
            </NativeSelect>
          </label>
          {fields.map(({ key, label, all, values }) => (
            <label key={key} className={styles.field}>
              <span>{label}</span>
              <NativeSelect className={styles.select} value={filters[key]} onChange={(event) => onChange({ [key]: event.target.value })}>
                <option value={all}>{all}</option>
                {values.map((value) => <option key={value}>{value}</option>)}
              </NativeSelect>
            </label>
          ))}
          <label className={styles.field}>
            <span>시도</span>
            <NativeSelect className={styles.select} value={filters.sido} onChange={(event) => onChange({ sido: event.target.value, sigungu: "시도 전체" })}>
              <option>전체 시도</option>
              {regions.sidos.map(([name, count]) => <option key={name} value={name}>{name} ({count.toLocaleString("ko-KR")})</option>)}
            </NativeSelect>
          </label>
          <label className={styles.field}>
            <span>시군구</span>
            <NativeSelect className={styles.select} value={filters.sigungu} disabled={filters.sido === "전체 시도"} onChange={(event) => onChange({ sigungu: event.target.value })}>
              <option>시도 전체</option>
              {regions.sigungus(filters.sido).map(([name, count]) => <option key={name} value={name}>{name} ({count.toLocaleString("ko-KR")})</option>)}
            </NativeSelect>
          </label>
        </div>
        <p className={styles.notice}>지역을 선택해도 중앙부처의 전국 공통 서비스는 함께 보입니다.</p>
        <div className={styles.actions}>
          <Button type="button" variant="outline" onClick={() => onChange(REGISTRY_FILTER_DEFAULTS)}>조건 초기화</Button>
          <Button type="button" onClick={() => setOpen(false)}>결과 보기</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
