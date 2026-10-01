import { cn } from "@repo/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";

type NavigationListProps = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function NavigationList({
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: NavigationListProps) {
  return (
    <ul
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
    >
      {children}
    </ul>
  );
}

type NavigationListItemProps = {
  href: LinkProps["href"];
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function NavigationListItem({
  href,
  children,
  className,
  "aria-label": ariaLabel,
}: NavigationListItemProps) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        aria-label={ariaLabel}
        className={cn(
          "relative flex min-h-12 min-w-0 items-center gap-2 px-3 py-3 transition-colors hover:bg-zinc-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900",
          className,
        )}
      >
        {children}
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-zinc-400"
        />
      </Link>
    </li>
  );
}
