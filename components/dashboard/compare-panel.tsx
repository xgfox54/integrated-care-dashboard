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
  municipalityKey,
  municipalityLabel,
  sortedUnique,
} from "@/lib/dataset";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const SLOT_COUNT = 3;
const MATRIX_LIMIT = 12;

interface CompareGroup {
  key: string;
  label: string;
  rows: ServiceRow[];
  nameSet: Set<string>;
}

export function ComparePanel({ rows }: { rows: ServiceRow[] }) {
  const optionKeys = useMemo(
    () => sortedUnique(rows.filter((row) => row.sido && row.sigungu).map(municipalityKey)),
    [rows],
  );

  const defaultKey = useMemo(
    () => optionKeys.find((key) => key.includes("서귀포")) ?? "",
    [optionKeys],
  );

  const [selection, setSelection] = useState<string[]>(() => [defaultKey, "", ""]);

  const groups = useMemo<CompareGroup[]>(() => {
    const chosen = [...new Set(selection.filter(Boolean))];
    return chosen.map((key) => {
      const groupRows = rows.filter((row) => municipalityKey(row) === key);
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
    <section aria-label="지자체 비교" className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">지자체 비교</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        최대 {SLOT_COUNT}개 시·군·구를 골라 사업 수와 분야 구성을 비교합니다.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: SLOT_COUNT }, (_, index) => (
          <div key={index} className="min-w-0">
            <Label htmlFor={`compare-${index}`} className="mb-1 text-sm">
              비교 대상 {index + 1}
            </Label>
            <div className="[&>div]:w-full">
              <NativeSelect
                id={`compare-${index}`}
                value={selection[index]}
                className="text-sm"
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
          </div>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          비교할 지자체를 선택하세요.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {groups.map((group) => {
              const categories = countBy(group.rows, (row) => row.category);
              return (
                <div key={group.key} className="rounded-md border border-border px-3 py-2">
                  <p className="font-semibold">{group.label}</p>
                  <p className="mt-1 text-2xl font-bold text-primary">
                    {NUMBER_FORMAT.format(group.rows.length)}
                    <span className="ml-1 text-base font-medium text-foreground">건</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    분야 {categories.length}개 · 최다 {categories[0]?.[0] ?? "-"}{" "}
                    {NUMBER_FORMAT.format(categories[0]?.[1] ?? 0)}건
                  </p>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">분야</TableHead>
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
                    <TableCell className="font-medium">{category}</TableCell>
                    {groups.map((group) => (
                      <TableCell key={group.key} className="text-right tabular-nums">
                        {NUMBER_FORMAT.format(
                          group.rows.filter((row) => (row.category || "미분류") === category).length,
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {groups.length >= 2 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold">사업명이 완전히 일치하는 사업</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  선택한 모든 지자체에 같은 사업명이 있는 경우입니다. {sharedNames.length}건.
                </p>
                {sharedNames.length > 0 ? (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
                    {sharedNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold">해당 지자체에만 있는 사업명</h3>
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
                        <p className="text-sm font-medium">
                          {group.label} · {unique.length}건
                        </p>
                        <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-sm text-muted-foreground">
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

          <p className="text-sm text-muted-foreground">
            사업명이 정확히 같은 경우만 공통으로 집계합니다. 이름이 비슷하다는 이유로 동일 사업으로
            판단하지 않으며, 사업 수는 수혜자 수나 예산 규모를 의미하지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
