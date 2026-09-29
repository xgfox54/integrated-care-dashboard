"use client";

import { SearchOperatorHelp } from "@/components/search/search-operator-help";
import { Button } from "@/components/ui/button";
import { Chip, ChipSet, RemovableChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { CloseIcon, RefreshIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  SERVICE_CATEGORY_ORDER,
  type FilterState,
} from "@/lib/dataset";
import type { DatasetSummary } from "@/lib/dataset-summary";

const QUICK_KEYWORDS = [
  "식사지원",
  "병원동행",
  "주거지원",
  "이동지원",
  "가사지원",
  "안전확인",
];

interface FilterPanelProps {
  summary: DatasetSummary;
  filters: FilterState;
  disabled: boolean;
  /** 지금 걸린 지역 조건. auto면 접속 위치로 자동으로 고른 지역이다. */
  region: { readonly label: string; readonly auto: boolean } | null;
  onChange: (next: Partial<FilterState>) => void;
  onClearRegion: () => void;
  onReset: () => void;
  /** 검색 버튼·Enter: 검색 결과로 화면을 내린다(검색은 입력하는 대로 이미 반영된다). */
  onSubmit: () => void;
}

interface SelectOption {
  value: string;
  label: string;
}

function asOptions(values: string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

function SelectField({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full"
      >
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

export function FilterPanel({
  summary,
  filters,
  disabled,
  region,
  onChange,
  onClearRegion,
  onReset,
  onSubmit,
}: FilterPanelProps) {
  const sidoOptions = Object.keys(summary.regionCounts).sort((left, right) => left.localeCompare(right, "ko"));
  const sigunguOptions = filters.sido
    ? [...(summary.sigunguBySido[filters.sido] ?? [])]
    : [...new Set(Object.values(summary.sigunguBySido).flat())].sort((left, right) => left.localeCompare(right, "ko"));
  const availableCategories = new Set(summary.categories);
  const categoryOptions = SERVICE_CATEGORY_ORDER.filter((category) => availableCategories.has(category));

  return (
    <section aria-label="검색 조건" className="rounded-xl border border-border bg-card p-4 print:hidden">
      <form
        role="search"
        aria-label="통합검색"
        onSubmit={(event) => {
          event.preventDefault();
          document.getElementById("keyword")?.blur();
          onSubmit();
        }}
        className="rounded-(--jeju-radius-lg) border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SearchIcon className="size-(--jeju-icon-lg) text-primary" aria-hidden="true" />
          <Label htmlFor="keyword" className="text-(length:--jeju-text-xl) font-extrabold text-(--jeju-text-strong)">
            통합검색
          </Label>
          <SearchOperatorHelp />
          <span className="text-(length:--jeju-text-sm) text-(--jeju-text-muted)">사업명·서비스·지원대상·지역을 한 번에 찾습니다</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-(--jeju-icon-lg) -translate-y-1/2 text-primary" aria-hidden="true" />
            <Input
              id="keyword"
              type="search"
              enterKeyHint="search"
              aria-describedby="keyword-privacy-note"
              value={filters.keyword}
              disabled={disabled}
              placeholder="검색어 입력 (예: 방문진료, 노인 or 장애인)"
              onChange={(event) => onChange({ keyword: event.target.value })}
              className="h-14 rounded-(--jeju-radius) border-2 border-primary bg-card pr-12 pl-12 text-(length:--jeju-text-lg) font-bold shadow-(--jeju-shadow-primary) placeholder:font-normal not-disabled:not-read-only:hover:border-(--jeju-primary-hover) [&::-webkit-search-cancel-button]:hidden"
            />
            {filters.keyword ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => onChange({ keyword: "" })}
                className="absolute top-1/2 right-2.5 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-(--jeju-radius-sm) border-0 bg-transparent text-muted-foreground outline-none hover:bg-muted hover:text-(--jeju-text-strong) focus-visible:shadow-(--jeju-focus-ring)"
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
          <Button type="submit" size="lg" disabled={disabled} className="h-12 px-7 text-(length:--jeju-text-md) sm:h-14">
            <SearchIcon className="size-(--jeju-icon-lg)" aria-hidden="true" />
            검색
          </Button>
        </div>
        <p id="keyword-privacy-note" className="mt-2 text-(length:--jeju-text-xs) text-(--jeju-text-muted)">
          대상자 이름, 주민등록번호, 전화번호 등 개인정보는 입력하지 마세요.
        </p>
      </form>

      {region ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">검색 지역</span>
          <RemovableChip
            removeLabel={region.label + " 지역 조건 지우고 전국에서 찾기"}
            onRemove={onClearRegion}
            className="border-primary bg-(--jeju-primary-tint) text-primary"
          >
            {region.label}
            {region.auto ? <span className="font-medium text-(--jeju-text-body)">· 접속 위치로 자동 선택</span> : null}
          </RemovableChip>
          <span className="text-(length:--jeju-text-sm) text-muted-foreground">
            {region.auto ? "지우면 전국에서 찾습니다. 검색어에 지역을 넣어도 됩니다(예: 부산 방문진료)." : "지우면 전국에서 찾습니다."}
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span id="quick-keyword-label" className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">
          빠른 검색
        </span>
        <ChipSet role="group" aria-labelledby="quick-keyword-label">
          {QUICK_KEYWORDS.map((keyword) => (
            <Chip
              key={keyword}
              pressed={filters.keyword === keyword}
              disabled={disabled}
              onPressedChange={(pressed) => onChange({ keyword: pressed ? keyword : "" })}
            >
              {keyword}
            </Chip>
          ))}
        </ChipSet>
        <Button type="button" variant="outline" onClick={onReset} disabled={disabled} className="ml-auto">
          <RefreshIcon />
          전체조건 초기화
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          id="filter-sido"
          label="광역시·도"
          value={filters.sido}
          options={asOptions(sidoOptions)}
          placeholder="전체 광역시·도"
          disabled={disabled}
          onChange={(value) => onChange({ sido: value, sigungu: "" })}
        />
        <SelectField
          id="filter-sigungu"
          label="기초시·군·구"
          value={filters.sigungu}
          options={asOptions(sigunguOptions)}
          placeholder="전체 기초시·군·구"
          disabled={disabled}
          onChange={(value) => onChange({ sigungu: value })}
        />
        <SelectField
          id="filter-category"
          label="사업 분류"
          value={filters.category}
          options={asOptions(categoryOptions)}
          placeholder="전체 선택"
          disabled={disabled}
          onChange={(value) => onChange({ category: value, subcategory: "" })}
        />
      </div>

      <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
        사업 분류는 보건복지부 공식 메뉴판의 대분류를 기준으로 표시하며, 표에 분류가 없는
        경우에만 사업명과 내용을 기준으로 보완합니다.
      </p>
    </section>
  );
}
