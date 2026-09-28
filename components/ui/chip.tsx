"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CloseIcon } from "@/components/ui/jeju-icons"

// 제주 고유 컴포넌트(Tier 1 .jeju-chip). 필터 칩은 aria-pressed로 켜짐을 알리고,
// 조건 칩의 제거 버튼은 무엇을 지우는지 드러나는 이름(removeLabel)을 가진다.
const chipBase =
  "inline-flex min-h-(--jeju-chip-h) items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1 text-(length:--jeju-text-sm) font-bold text-(--jeju-text-body) [&_svg]:size-3.5 [&_svg]:shrink-0"

function ChipSet({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chip-set"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}

function Chip({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      data-slot="chip"
      className={cn(
        chipBase,
        "cursor-pointer transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) disabled:pointer-events-none disabled:text-(--jeju-disabled-text) data-[state=on]:border-primary data-[state=on]:bg-(--jeju-primary-tint) data-[state=on]:text-primary forced-colors:data-[state=on]:forced-color-adjust-none forced-colors:data-[state=on]:bg-[Highlight] forced-colors:data-[state=on]:text-[HighlightText]",
        className
      )}
      {...props}
    />
  )
}

function RemovableChip({
  className,
  children,
  removeLabel,
  onRemove,
  ...props
}: React.ComponentProps<"span"> & {
  removeLabel: string
  onRemove?: () => void
}) {
  return (
    <span data-slot="removable-chip" className={cn(chipBase, "pr-1.5", className)} {...props}>
      {children}
      <button
        type="button"
        data-slot="chip-remove"
        aria-label={removeLabel}
        onClick={onRemove}
        className="relative inline-grid size-(--jeju-chip-remove) cursor-pointer place-items-center rounded-full border-0 bg-muted p-0 text-muted-foreground outline-none after:absolute after:top-1/2 after:left-1/2 after:size-(--jeju-target-min) after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-(--jeju-border-strong) hover:text-(--jeju-text-strong) focus-visible:shadow-(--jeju-focus-ring) [&_svg]:size-3!"
      >
        <CloseIcon />
      </button>
    </span>
  )
}

export { Chip, ChipSet, RemovableChip }
