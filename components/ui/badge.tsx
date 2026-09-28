import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// 상태 배지는 항상 문구와 함께 쓴다. 색만으로 상태를 전달하지 않는다.
// info/success/warning/danger/neutral은 Tier 1 .jeju-badge--*와 같은 역할색이다.
const badgeVariants = cva(
  "group/badge inline-flex min-h-6 w-fit shrink-0 items-center justify-center gap-1.25 overflow-hidden rounded-4xl border border-transparent px-2 py-0.75 text-(length:--jeju-text-xs) leading-none font-extrabold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-(--jeju-primary-hover)",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-(--jeju-danger-tint) text-(--jeju-danger)",
        outline: "border-border text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        info: "bg-(--jeju-info-tint) text-(--jeju-info)",
        success: "bg-(--jeju-success-tint) text-(--jeju-success)",
        warning: "bg-(--jeju-warning-tint) text-(--jeju-warning)",
        danger: "bg-(--jeju-danger-tint) text-(--jeju-danger)",
        neutral: "bg-(--jeju-control-bg) text-(--jeju-text-muted)",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
