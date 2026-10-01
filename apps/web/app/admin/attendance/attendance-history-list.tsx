import type { AttendanceEventHistoryItem, UserListItem } from "@repo/contracts";
import { formatTokyoDateTime } from "../../../lib/display-date-time";

function assertNever(value: never): never {
  throw new Error(`Unsupported attendance event: ${String(value)}`);
}

function getEventLabel(event: AttendanceEventHistoryItem) {
  switch (event.eventType) {
    case "AttendanceClockedIn":
      return `出勤を記録（${formatTokyoDateTime(event.payload.clockInAt)}）`;
    case "AttendanceClockedOut":
      return `退勤を記録（${formatTokyoDateTime(event.payload.clockOutAt)}）`;
    case "WorkPeriodCorrected":
      return event.payload.workPeriod === "day"
        ? "勤務区分を訂正（昼）"
        : "勤務区分を訂正（夜）";
    case "ClockInTimeCorrected":
      return `出勤時刻を訂正（${formatTokyoDateTime(event.payload.clockInAt)}）`;
    case "ClockOutTimeCorrected":
      return `退勤時刻を訂正（${formatTokyoDateTime(event.payload.clockOutAt)}）`;
    case "AttendanceCancelled":
      return "勤怠を取消";
    default:
      return assertNever(event);
  }
}

export function AttendanceHistoryList({
  events,
  users,
}: {
  events: readonly AttendanceEventHistoryItem[];
  users: readonly UserListItem[];
}) {
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const operator = users.find(
          (user) => user.userId === event.performedByUserId,
        );
        return (
          <li
            key={event.eventId}
            className="rounded-md border border-zinc-200 bg-white p-3 text-sm"
          >
            <div className="flex flex-col gap-1">
              <p className="font-medium">{getEventLabel(event)}</p>
              <time
                className="text-xs tabular-nums text-zinc-500"
                dateTime={event.createdAt}
              >
                {formatTokyoDateTime(event.createdAt)}
              </time>
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              操作者：{operator?.displayName ?? "名前未設定"}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
