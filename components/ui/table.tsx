import * as React from "react"

import { cn } from "@/lib/utils"

// Tier 1 .jeju-table과 같은 모양: 테두리 래퍼, 헤더 상단 2px Primary, 숫자 열 오른쪽 정렬(num).
// 긴 표는 이 래퍼 안에서만 가로로 스크롤한다. 고정 헤더가 필요하면 containerClassName에 max-h-*를 준다.
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto rounded-xl border border-border bg-card print:overflow-visible print:rounded-none print:border-0",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-(length:--jeju-table-font)",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead data-slot="table-header" className={cn(className)} {...props} />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&>tr:last-child>*]:border-b-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-(--jeju-surface-inset) font-extrabold [&>tr>*]:border-t [&>tr>*]:border-border",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors hover:bg-(--jeju-row-hover) has-aria-expanded:bg-muted data-[state=selected]:bg-(--jeju-primary-tint)",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  num = false,
  ...props
}: React.ComponentProps<"th"> & { num?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-num={num || undefined}
      className={cn(
        "border-t-2 border-b border-t-primary border-b-border bg-(--jeju-surface-inset) p-(--jeju-cell-pad) text-left align-middle font-extrabold whitespace-nowrap text-muted-foreground data-num:text-right data-num:tabular-nums [&:has([role=checkbox])]:w-12 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  num = false,
  ...props
}: React.ComponentProps<"td"> & { num?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-num={num || undefined}
      className={cn(
        "border-b border-(--jeju-hairline) p-(--jeju-cell-pad) text-left align-middle data-num:text-right data-num:tabular-nums [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-(length:--jeju-text-sm) text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
