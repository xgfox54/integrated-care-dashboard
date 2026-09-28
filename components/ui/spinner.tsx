import * as React from "react"

import { cn } from "@/lib/utils"

// Tier 1 .jeju-spinner와 같은 테두리형 회전 표시. 동작 감소 설정이면 토큰 파일이 회전을 멈춘다.
function Spinner({
  className,
  label = "불러오는 중",
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label={label}
      className={cn(
        "inline-block size-(--jeju-icon) shrink-0 animate-spin rounded-full border-2 border-border border-t-primary",
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
