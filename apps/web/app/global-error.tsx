"use client";

import { Button } from "@repo/ui/components/button";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <main className="flex min-h-dvh w-full flex-1 justify-center text-zinc-950">
          <div className="flex min-h-dvh w-full max-w-[448px] items-center justify-center border-x border-zinc-300 bg-surface px-4 py-8">
            <section
              aria-labelledby="global-error-title"
              className="w-full rounded-md border border-zinc-200 bg-white p-5 text-center sm:p-6"
            >
              <p className="text-sm font-medium text-zinc-500">TimeCard</p>
              <h1
                id="global-error-title"
                className="mt-3 text-lg font-semibold text-zinc-900"
              >
                エラーが発生しました
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                予期しない問題が発生しました。時間をおいて、もう一度お試しください。
              </p>
              <Button
                type="button"
                className="mt-5 w-full sm:w-auto"
                onClick={() => unstable_retry()}
              >
                もう一度試す
              </Button>
            </section>
          </div>
        </main>
      </body>
    </html>
  );
}
