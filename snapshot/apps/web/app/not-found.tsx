export default function NotFound() {
  return (
    <main className="flex min-h-dvh w-full flex-1 justify-center text-zinc-950">
      <div className="flex min-h-dvh w-full max-w-[448px] items-center justify-center border-x border-zinc-300 bg-surface px-4 py-8">
        <section className="w-full rounded-md border border-zinc-200 bg-white p-6 text-center">
          <p className="text-4xl leading-none font-semibold text-zinc-700">
            404
          </p>
          <h1 className="mt-3 text-base font-medium">ページが見つかりません</h1>
        </section>
      </div>
    </main>
  );
}
