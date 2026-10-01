"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "../lib/utils";

function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectPrimitive.Root.Props<Value, Multiple>,
) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("line-clamp-1 flex items-center gap-2", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon aria-hidden="true" />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  ...props
}: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        data-slot="select-positioner"
        alignItemWithTrigger={false}
        className="z-50 max-w-[calc(100vw-1rem)] outline-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "relative min-w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-x-hidden rounded-lg border bg-popover text-popover-foreground shadow-md outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="flex h-4 items-center justify-center bg-popover text-muted-foreground"
            aria-hidden="true"
          >
            <ChevronUpIcon className="size-3" />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List className="max-h-[var(--available-height)] overflow-y-auto overflow-x-hidden p-1">
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow
            className="flex h-4 items-center justify-center bg-popover text-muted-foreground"
            aria-hidden="true"
          >
            <ChevronDownIcon className="size-3" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText
        data-slot="select-item-text"
        className="flex-1 truncate"
      >
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-4 items-center justify-center"
      >
        <CheckIcon aria-hidden="true" className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
