import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// info/success/warning/danger는 Tier 1 .jeju-alert--*와 같은 역할색이다. 제목(AlertTitle)으로 상태를 문구로도 밝힌다.
// 정적인 안내문에는 role="note"를 넘겨 스크린리더가 불필요하게 끼어들지 않게 한다.
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-4 py-3.5 text-left text-(length:--jeju-text-base) has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-(--jeju-blue-light-strong) bg-(--jeju-info-tint) text-(--jeju-info) *:data-[slot=alert-description]:text-current",
        success:
          "border-(--jeju-green-light-strong) bg-(--jeju-success-tint) text-(--jeju-success) *:data-[slot=alert-description]:text-current",
        warning:
          "border-(--jeju-orange-light-strong) bg-(--jeju-warning-tint) text-(--jeju-warning) *:data-[slot=alert-description]:text-current",
        danger:
          "border-border bg-(--jeju-danger-tint) text-(--jeju-danger) *:data-[slot=alert-description]:text-current",
        destructive:
          "border-border bg-(--jeju-danger-tint) text-(--jeju-danger) *:data-[slot=alert-description]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-bold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-(length:--jeju-text-base) text-pretty text-(--jeju-text-body) group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-2.5", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
