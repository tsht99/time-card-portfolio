import { Button } from "@repo/ui/components/button";
import { Pencil, UserRound } from "lucide-react";

export function UserContextCard({
  displayName,
  onEditDisplayName,
  editDisabled = false,
}: {
  displayName: string | null;
  onEditDisplayName?: () => void;
  editDisabled?: boolean;
}) {
  return (
    <section
      aria-label="対象ユーザー"
      className="flex min-h-14 min-w-0 items-center gap-3 rounded-md border border-zinc-200 bg-white p-3"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600">
        <UserRound aria-hidden="true" className="size-5" />
      </span>
      <p className="min-w-0 flex-1 break-words text-base font-medium text-zinc-900">
        {displayName ?? "名前未設定"}
      </p>
      {onEditDisplayName && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="表示名を編集"
          disabled={editDisabled}
          onClick={onEditDisplayName}
          className="text-zinc-700"
        >
          <Pencil aria-hidden="true" className="size-5" />
        </Button>
      )}
    </section>
  );
}
