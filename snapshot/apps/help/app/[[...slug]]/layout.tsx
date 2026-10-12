import type { Node } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import Link from "next/link";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { baseOptions } from "../layout.config";

function NavigationItems({ items }: { items: Node[] }) {
  return items.map((item, index) => {
    const key = item.$id ?? `${item.type}-${index}`;

    if (item.type === "page") {
      return (
        <Link key={key} href={item.url}>
          {item.name}
        </Link>
      );
    }

    if (item.type === "separator") {
      return item.name ? <p key={key}>{item.name}</p> : null;
    }

    return (
      <details key={key}>
        <summary>{item.name}</summary>
        <div>
          {item.index ? (
            <Link href={item.index.url}>{item.index.name}</Link>
          ) : null}
          <NavigationItems items={item.children} />
        </div>
      </details>
    );
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      {...baseOptions}
      sidebar={{ enabled: false }}
      nav={{
        ...baseOptions.nav,
        children: (
          <details className="help-navigation">
            <summary>ページ</summary>
            <nav aria-label="ガイドのページ">
              <NavigationItems items={source.pageTree.children} />
            </nav>
          </details>
        ),
      }}
      containerProps={{
        className:
          "mx-auto w-full max-w-[448px] border-x border-zinc-300 bg-fd-background",
        style: {
          gridTemplate:
            '"header" 3.5rem "main" minmax(0, 1fr) / minmax(0, 1fr)',
        },
      }}
    >
      {children}
    </DocsLayout>
  );
}
