export default function Loading() {
  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        <section className="mt-6" aria-label="勤怠一覧" aria-busy="true">
          <p
            className="mt-3 text-sm text-zinc-600"
            role="status"
            aria-live="polite"
          >
            勤怠一覧を読み込み中
          </p>
        </section>
      </section>
    </main>
  );
}
