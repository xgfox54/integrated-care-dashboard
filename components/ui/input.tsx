import * as React from "react"

import { cn } from "@/lib/utils"

// 상태 계층: 기본 / hover / focus / readonly / disabled / 오류(aria-invalid). 높이는 --jeju-input-h.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-(--jeju-input-h) w-full min-w-0 rounded-lg border border-input bg-card px-2.75 py-1 text-(length:--jeju-control-font) text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-(length:--jeju-text-sm) file:font-bold file:text-foreground placeholder:text-muted-foreground not-disabled:not-read-only:hover:border-(--jeju-text-faint) read-only:border-border read-only:bg-(--jeju-readonly-bg) focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) disabled:cursor-not-allowed disabled:border-(--jeju-disabled-border) disabled:bg-(--jeju-disabled-bg) disabled:text-(--jeju-disabled-text) aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
