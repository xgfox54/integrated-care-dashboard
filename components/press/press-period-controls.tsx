"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PRESS_PERIODS, selectPressPeriod } from "@/lib/press-period";
import type { PressPeriodSelection } from "@/lib/press-period";

interface Props {
  readonly selection: PressPeriodSelection;
  readonly onChange: (selection: PressPeriodSelection) => void;
}

export function PressPeriodControls({ selection, onChange }: Props) {
  const unknownDate = selection.period === "unknown";
  return (
    <div className="flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)" role="group" aria-label="게시 기간 조건">
      <Label htmlFor="press-period" className="sr-only">게시 기간</Label>
      <NativeSelect id="press-period" size="sm" value={selection.period} onChange={(event) => onChange(selectPressPeriod(event.target.value, selection))}>
        {PRESS_PERIODS.map((period) => <NativeSelectOption key={period.value} value={period.value}>{period.label}</NativeSelectOption>)}
      </NativeSelect>
      <div className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor="press-from" className="shrink-0">시작일</Label>
        <Input id="press-from" type="date" className="h-8 w-32 min-w-0" value={selection.from} max={selection.to || undefined} disabled={unknownDate}
          onChange={(event) => onChange({ ...selection, period: "custom", from: event.target.value })} />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor="press-to" className="shrink-0">종료일</Label>
        <Input id="press-to" type="date" className="h-8 w-32 min-w-0" value={selection.to} min={selection.from || undefined} disabled={unknownDate}
          onChange={(event) => onChange({ ...selection, period: "custom", to: event.target.value })} />
      </div>
    </div>
  );
}
