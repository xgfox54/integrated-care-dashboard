"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// required를 주면 별표 대신 "필수" 문구를 붙인다(Tier 1 .jeju-required).
function Label({
  className,
  required = false,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-baseline gap-2 text-(length:--jeju-label-font) leading-snug font-bold text-(--jeju-text-body) select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-(--jeju-disabled-text) peer-disabled:cursor-not-allowed peer-disabled:text-(--jeju-disabled-text)",
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span
          data-slot="label-required"
          className="text-(length:--jeju-text-xs) font-extrabold text-destructive"
        >
          필수
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
}

export { Label }
