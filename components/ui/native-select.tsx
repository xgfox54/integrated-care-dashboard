import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "@/components/ui/jeju-icons"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn("group/native-select relative w-fit", className)}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-(--jeju-input-h) w-full min-w-0 appearance-none rounded-lg border border-input bg-card py-1 pr-9 pl-2.75 text-(length:--jeju-control-font) text-foreground transition-colors outline-none select-none not-disabled:hover:border-(--jeju-text-faint) focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring) disabled:cursor-not-allowed disabled:border-(--jeju-disabled-border) disabled:bg-(--jeju-disabled-bg) disabled:text-(--jeju-disabled-text) aria-invalid:border-destructive data-[size=sm]:h-(--jeju-control-h-sm) data-[size=sm]:pr-8 data-[size=sm]:pl-2 data-[size=sm]:text-(length:--jeju-control-font-sm)"
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground select-none group-data-[size=sm]/native-select:right-2"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
