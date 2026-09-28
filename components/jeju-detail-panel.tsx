"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

// 상세 보기 사이드 패널(Tier 1 dialog.jeju-modal--side). 목록에서 한 건을 골라 화면을 떠나지 않고 내용을 본다.
// 포커스를 가두고 Esc로 닫으며, 닫히면 연 요소로 포커스를 돌려준다. 폭은 --jeju-side-panel-w.
// 패널이 열려 있을 때 인쇄하면 패널 내용만 나온다(jeju-theme의 @media print 규칙).
// Radix는 전용 Trigger가 있을 때만 포커스를 돌려주므로, 표 안의 버튼처럼 상태로 여는 경우를 위해
// 열리는 순간 포커스가 있던 요소를 기억했다가 닫힐 때 돌려준다.
function DetailPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const returnFocus = React.useRef<HTMLElement | null>(null)

  // 레이아웃 효과는 패널 안 포커스 이동(자식의 일반 효과)보다 먼저 실행되므로 연 요소를 잡을 수 있다.
  React.useLayoutEffect(() => {
    if (open) returnFocus.current = document.activeElement as HTMLElement | null
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("gap-0 data-[side=right]:w-[min(var(--jeju-side-panel-w),100vw)]", className)}
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current
          if (target && target.isConnected) {
            event.preventDefault()
            target.focus()
          }
        }}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-(length:--jeju-text-xl)">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 print:overflow-visible">{children}</div>
        {footer ? (
          <SheetFooter className="flex-row flex-wrap justify-end border-t border-border">{footer}</SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailList({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode }>
  className?: string
}) {
  return (
    <dl data-slot="detail-list" className={cn("m-0 grid", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="grid grid-cols-[8em_minmax(0,1fr)] gap-3 border-b border-(--jeju-hairline) py-3 last:border-b-0 max-[560px]:grid-cols-1 max-[560px]:gap-0.5"
        >
          <dt className="font-bold text-muted-foreground">{item.label}</dt>
          <dd className="m-0 wrap-anywhere text-(--jeju-text-body)">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export { DetailList, DetailPanel }
