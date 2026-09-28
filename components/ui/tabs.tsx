"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// 기본 변형은 Tier 1 .jeju-tab과 같은 밑줄형(line)이다. 상자형이 필요하면 variant="default".
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn("group/tabs flex gap-3.5 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "w-fit justify-center rounded-lg bg-muted p-[3px] group-data-horizontal/tabs:h-(--jeju-control-h)",
        line: "w-full max-w-full justify-start gap-1 overflow-x-auto bg-transparent group-data-horizontal/tabs:border-b group-data-horizontal/tabs:border-border group-data-vertical/tabs:w-fit group-data-vertical/tabs:border-r group-data-vertical/tabs:border-border",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  }
)

function TabsList({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-1.5 border border-transparent px-3.25 text-(length:--jeju-control-font) font-bold whitespace-nowrap text-muted-foreground transition-all outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) disabled:pointer-events-none disabled:text-(--jeju-disabled-text) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=default]/tabs-list:h-[calc(100%-1px)] group-data-[variant=default]/tabs-list:flex-1 group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm",
        "group-data-[variant=line]/tabs-list:min-h-(--jeju-control-h) group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:data-active:text-primary forced-colors:data-active:border-[Highlight]",
        "group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:border-b-[3px] group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:data-active:border-b-primary group-data-vertical/tabs:group-data-[variant=line]/tabs-list:border-r-[3px] group-data-vertical/tabs:group-data-[variant=line]/tabs-list:data-active:border-r-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-w-0 flex-1 text-(length:--jeju-text-base) outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
