import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-[110px] w-full resize-y rounded-lg border border-input bg-card px-2.75 py-2 text-(length:--jeju-control-font) text-foreground transition-colors outline-none placeholder:text-muted-foreground not-disabled:not-read-only:hover:border-(--jeju-text-faint) read-only:border-border read-only:bg-(--jeju-readonly-bg) focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) disabled:cursor-not-allowed disabled:border-(--jeju-disabled-border) disabled:bg-(--jeju-disabled-bg) disabled:text-(--jeju-disabled-text) aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
