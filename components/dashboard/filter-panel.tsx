"use client";

import { RotateCcw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onChange: (next: Partial<FilterState>) => void;
  onReset: () => void;
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
    <div className="min-w-0">
      <Label htmlFor={id} className="mb-1 text-sm">
        {label}
      </Label>
      <div className="[&>div]:w-full">
        <NativeSelect
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="text-sm"
        >
          <NativeSelectOption value="">{placeholder}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

export function FilterPanel({
  summary,
  filters,
  disabled,
  onChange,
  onReset,
}: FilterPanelProps) {
  const sidoOptions = Object.keys(summary.regionCounts).sort((left, right) => left.localeCompare(right, "ko"));
  const sigunguOptions = filters.sido
    ? [...(summary.sigunguBySido[filters.sido] ?? [])]
    : [...new Set(Object.values(summary.sigunguBySido).flat())].sort((left, right) => left.localeCompare(right, "ko"));
  const availableCategories = new Set(summary.categories);
  const categoryOptions = SERVICE_CATEGORY_ORDER.filter((category) => availableCategories.has(category));

  return (
    <section aria-label="검색 조건" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <Label htmlFor="keyword" className="mb-1 text-sm">
            통합검색
          </Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="keyword"
              value={filters.keyword}
              disabled={disabled}
              placeholder="사업명, 서비스, 지원대상 또는 지역을 검색하세요"
              onChange={(event) => onChange({ keyword: event.target.value })}
              className="pr-10 pl-9 text-base"
            />
            {filters.keyword ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => onChange({ keyword: "" })}
                className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onReset} disabled={disabled}>
          <RotateCcw aria-hidden="true" />
          전체조건 초기화
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">빠른 검색</span>
        {QUICK_KEYWORDS.map((keyword) => (
          <Button
            key={keyword}
            type="button"
            variant={filters.keyword === keyword ? "default" : "secondary"}
            size="sm"
            disabled={disabled}
            onClick={() => onChange({ keyword })}
          >
            {keyword}
          </Button>
        ))}
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

      <p className="mt-2 text-sm text-muted-foreground">
        사업 분류는 보건복지부 공식 메뉴판의 대분류를 기준으로 표시하며, 표에 분류가 없는
        경우에만 사업명과 내용을 기준으로 보완합니다.
      </p>
    </section>
  );
}
