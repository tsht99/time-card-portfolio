import { cn } from "@repo/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";

type NavigationCardProps = {
  href: LinkProps["href"];
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function NavigationCard({
  href,
  children,
  className,
  "aria-label": ariaLabel,
}: NavigationCardProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "flex min-h-12 min-w-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-3 transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-zinc-400"
      />
    </Link>
  );
}
