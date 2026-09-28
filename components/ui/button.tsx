import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn 공식 button + 제주 토큰. 변형 이름은 Tier 1(.jeju-btn--*)과 같다.
// secondary = Green 역할색(strong), accent = Orange 역할색(strong). 치수는 프로필 토큰을 따른다.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-(length:--jeju-control-font) font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:border-(--jeju-disabled-border) disabled:bg-(--jeju-disabled-bg) disabled:text-(--jeju-disabled-text) disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:border-(--jeju-disabled-border) aria-disabled:bg-(--jeju-disabled-bg) aria-disabled:text-(--jeju-disabled-text) aria-disabled:shadow-none aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--jeju-icon)",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-(--jeju-shadow-primary) hover:bg-(--jeju-primary-hover) active:bg-(--jeju-primary-active)",
        secondary:
          "bg-(--jeju-secondary-strong) text-(--jeju-on-fill) hover:bg-(--jeju-green-deep)",
        accent:
          "bg-(--jeju-accent-strong) text-(--jeju-on-fill) hover:bg-(--jeju-orange-deep)",
        outline:
          "border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        ghost:
          "text-(--jeju-text-body) hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        destructive: "bg-destructive text-(--jeju-on-fill)",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-(--jeju-control-h) gap-1.5 px-3.5",
        xs: "h-6 gap-1 rounded-md px-2 text-(length:--jeju-text-xs)",
        sm: "h-(--jeju-control-h-sm) gap-1.5 px-3 text-(length:--jeju-control-font-sm)",
        lg: "h-(--jeju-control-h-lg) gap-2 px-4.5 text-(length:--jeju-control-font-lg)",
        icon: "size-(--jeju-control-h)",
        "icon-xs": "size-6 rounded-md",
        "icon-sm": "size-(--jeju-control-h-sm)",
        "icon-lg": "size-(--jeju-control-h-lg)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
