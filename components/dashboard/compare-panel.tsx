"use client";

import { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ServiceRow,
  collapse,
  countBy,
  municipalityLabel,
  sortedUnique,
} from "@/lib/dataset";
import { RegionalIndicatorTable } from "@/components/dashboard/regional-indicator-table";
import { JEJU_ADMIN_CITIES, JEJU_PROVINCE } from "@/lib/admin-city";
import { regionRows } from "@/lib/regional-indicators";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const SLOT_COUNT = 3;
const MATRIX_LIMIT = 12;

interface CompareGroup {
  key: string;
  label: string;
  rows: ServiceRow[];
  nameSet: Set<string>;
}

export function ComparePanel({ rows, dataAsOf = "" }: { rows: ServiceRow[]; dataAsOf?: string }) {
  const optionKeys = useMemo(() => {
    const keys = rows.filter((row) => row.sido && row.sigungu).map((row) => row.sido + "|" + row.sigungu);
    if (rows.some((row) => row.sido === JEJU_PROVINCE)) keys.push(...JEJU_ADMIN_CITIES.map((city) => JEJU_PROVINCE + "|" + city));
    return sortedUnique(keys);
  }, [rows]);

  const defaultKey = useMemo(
    () => optionKeys.find((key) => key.includes("서귀포")) ?? "",
    [optionKeys],
  );

  const [selection, setSelection] = useState<string[]>(() => [defaultKey, "", ""]);

  const groups = useMemo<CompareGroup[]>(() => {
    const chosen = [...new Set(selection.filter(Boolean))];
    return chosen.map((key) => {
      const groupRows = regionRows(rows, key);
      return {
        key,
        label: municipalityLabel(key),
        rows: groupRows,
        nameSet: new Set(groupRows.map((row) => collapse(row.name)).filter(Boolean)),
      };
    });
  }, [rows, selection]);

  const matrixCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const group of groups) {
      for (const [label, value] of countBy(group.rows, (row) => row.category)) {
        totals.set(label, (totals.get(label) ?? 0) + value);
      }
    }
    return [...totals.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, MATRIX_LIMIT)
      .map(([label]) => label);
  }, [groups]);

  const sharedNames = useMemo(() => {
    if (groups.length < 2) return [];
    const [first, ...others] = groups;
    const shared: string[] = [];
    for (const row of first.rows) {
      const key = collapse(row.name);
      if (!key) continue;
      if (shared.some((name) => collapse(name) === key)) continue;
      if (others.every((group) => group.nameSet.has(key))) shared.push(row.name);
    }
    return shared;
  }, [groups]);

  return (
    <section aria-label="지자체 비교" className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">지자체 비교</h2>
      <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
        최대 {SLOT_COUNT}개 시·군·구(제주 행정시 포함)를 골라 사업 수, 분야 구성, 고령인구 대비 지표를 같은 기준으로 비교합니다.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: SLOT_COUNT }, (_, index) => (
          <div key={index} className="grid min-w-0 gap-1.5">
            <Label htmlFor={`compare-${index}`}>
              비교 대상 {index + 1}
            </Label>
            <NativeSelect
              id={`compare-${index}`}
              value={selection[index]}
              className="w-full"
              onChange={(event) =>
                setSelection((current) =>
                  current.map((value, slot) => (slot === index ? event.target.value : value)),
                )
              }
            >
              <NativeSelectOption value="">선택 안 함</NativeSelectOption>
              {optionKeys.map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {municipalityLabel(key)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-(--jeju-border-strong) px-4 py-6 text-center text-(length:--jeju-text-sm) text-muted-foreground">
          비교할 지자체를 선택하세요.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {groups.map((group) => {
              const categories = countBy(group.rows, (row) => row.category);
              return (
                <div key={group.key} className="rounded-lg border border-border bg-(--jeju-surface-inset) px-3 py-2.5">
                  <p className="font-extrabold text-(--jeju-text-strong)">{group.label}</p>
                  <p className="mt-1 text-(length:--jeju-text-2xl) font-extrabold tabular-nums text-primary">
                    {NUMBER_FORMAT.format(group.rows.length)}
                    <span className="ml-1 text-(length:--jeju-text-base) font-bold text-(--jeju-text-body)">건</span>
                  </p>
                  <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
                    분야 {categories.length}개 · 최다 {categories[0]?.[0] ?? "-"}{" "}
                    {NUMBER_FORMAT.format(categories[0]?.[1] ?? 0)}건
                  </p>
                </div>
              );
            })}
          </div>

          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">분야 (구성비)</TableHead>
                  {groups.map((group) => (
                    <TableHead key={group.key} className="text-right">
                      {group.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixCategories.map((category) => (
                  <TableRow key={category}>
                    <TableCell className="font-bold">{category}</TableCell>
                    {groups.map((group) => (
                      <TableCell key={group.key} className="text-right tabular-nums">
                        {(() => {
                          const count = group.rows.filter((row) => (row.category || "미분류") === category).length;
                          const share = group.rows.length ? Math.round((count / group.rows.length) * 1000) / 10 : 0;
                          return NUMBER_FORMAT.format(count) + "건 (" + share + "%)";
                        })()}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RegionalIndicatorTable rows={rows} keys={groups.map((group) => group.key)} dataAsOf={dataAsOf} />

          {groups.length >= 2 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <h3 className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">사업명이 완전히 일치하는 사업</h3>
                <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
                  선택한 모든 지자체에 같은 사업명이 있는 경우입니다. {sharedNames.length}건.
                </p>
                {sharedNames.length > 0 ? (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-(length:--jeju-text-sm)">
                    {sharedNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="rounded-lg border border-border p-3">
                <h3 className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">해당 지자체에만 있는 사업명</h3>
                <div className="mt-2 space-y-3">
                  {groups.map((group) => {
                    const others = groups.filter((entry) => entry.key !== group.key);
                    const unique = sortedUnique(
                      group.rows
                        .filter((row) => row.name)
                        .filter((row) => others.every((entry) => !entry.nameSet.has(collapse(row.name))))
                        .map((row) => row.name),
                    );
                    return (
                      <div key={group.key}>
                        <p className="text-(length:--jeju-text-sm) font-bold">
                          {group.label} · {unique.length}건
                        </p>
                        <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-(length:--jeju-text-sm) text-muted-foreground">
                          {unique.slice(0, 30).map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <p className="text-(length:--jeju-text-sm) text-muted-foreground">
            사업명이 정확히 같은 경우만 공통으로 집계합니다. 이름이 비슷하다는 이유로 동일 사업으로
            판단하지 않으며, 사업 수는 수혜자 수나 예산 규모를 의미하지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
