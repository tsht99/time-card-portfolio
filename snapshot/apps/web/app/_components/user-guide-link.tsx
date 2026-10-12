import { env } from "../../env";
import { getUserGuideUrl } from "../../lib/user-guide";

export function UserGuideLink({ pathname }: { pathname: string }) {
  return (
    <a
      href={getUserGuideUrl(env.NEXT_PUBLIC_HELP_URL, pathname)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-auto block pt-4 text-center text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
    >
      利用者ガイド ↗
    </a>
  );
}
