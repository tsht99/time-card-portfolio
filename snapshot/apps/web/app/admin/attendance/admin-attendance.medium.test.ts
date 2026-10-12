import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { attendanceCurrentStates, attendanceEvents, users } from "@repo/db";
import type { PostgresDatabase } from "@repo/postgres";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { assertAdminRouteReadiness } from "web/test-support/browser/admin-route-readiness";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { testTokyoDateAt } from "web/test-support/browser/reference-time";

const TEST_MONTH = "2026-01";
const TEST_FROM = `${TEST_MONTH}-01`;
const TEST_TO = `${TEST_MONTH}-31`;
const ATTENDANCE_OVERLAP_MESSAGE =
  "既存の勤怠と勤務時間が重複しています。時刻を確認してください。";

type AttendanceExpectation = {
  attendanceDate: string;
  clockInAt: Date;
  clockOutAt: Date;
  userId: string;
};

function formatAttendanceDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function formatAttendanceDateForDisplay(attendanceDate: string) {
  return attendanceDate.replaceAll("-", "/");
}

function getAttendanceDateGroup(page: Page, attendanceDate: string) {
  return page.getByRole("list", { name: "勤怠一覧" }).getByRole("list", {
    name: formatAttendanceDateForDisplay(attendanceDate),
  });
}

function getAttendanceLink(
  page: Page,
  displayName: string,
  attendanceDate?: string,
) {
  const scope = attendanceDate
    ? getAttendanceDateGroup(page, attendanceDate)
    : page.getByRole("list", { name: "勤怠一覧" });
  return scope
    .getByRole("link", { name: /勤怠詳細へ移動/ })
    .filter({ hasText: displayName });
}

function getAttendanceRow(
  page: Page,
  displayName: string,
  attendanceDate?: string,
) {
  return getAttendanceLink(page, displayName, attendanceDate).locator("..");
}

async function readDisplayName(db: PostgresDatabase, userId: string) {
  const [user] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.displayName) {
    throw new Error(`表示名を取得できませんでした: ${userId}`);
  }
  return user.displayName;
}

async function createAttendanceThroughForm({
  attendanceDate,
  clockInAt,
  clockOutAt,
  displayName,
  page,
}: {
  attendanceDate: string;
  clockInAt: Date;
  clockOutAt: Date;
  displayName: string;
  page: Page;
}) {
  await page.goto("/admin/attendance/new");
  await expect(page.getByRole("heading", { name: "勤怠作成" })).toBeVisible();
  await assertAdminRouteReadiness(page);
  const target = page.getByLabel("作成対象者");
  await target.click();
  await expect(
    page.getByRole("option", { name: displayName, exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: displayName, exact: true }).click();
  await expect(target).toHaveText(displayName);
  await page.getByText("昼", { exact: true }).click();
  await page.getByLabel("作成出勤日時").fill(`${attendanceDate}T09:00`);
  await page.getByLabel("作成退勤日時").fill(`${attendanceDate}T18:00`);
  await page.getByRole("button", { name: "作成" }).click();

  const attendanceDetailUrlPattern =
    /\/admin\/attendance\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  await expect(page).toHaveURL(attendanceDetailUrlPattern);
  const attendancePath = new URL(page.url()).pathname;
  const attendanceId = attendancePath.match(
    /^\/admin\/attendance\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  )?.[1];
  if (!attendanceId) {
    throw new Error("作成された勤怠IDを取得できません。");
  }
  return { attendanceId, attendanceDate, clockInAt, clockOutAt };
}

async function assertCompletedAttendanceDetail(
  page: Page,
  attendance: {
    attendanceDate: string;
    clockInAt: Date;
    clockOutAt: Date;
    displayName: string;
  },
) {
  const detailSummary = page.getByRole("region", {
    name: "勤怠の現在状態",
  });
  const userContextCard = page.getByRole("region", { name: "対象ユーザー" });
  const date = formatAttendanceDateForDisplay(attendance.attendanceDate);
  await expect(
    userContextCard.getByText(attendance.displayName, { exact: true }),
  ).toHaveCount(1);
  await expect(
    detailSummary.getByText(attendance.displayName, { exact: true }),
  ).toHaveCount(0);
  await expect(detailSummary.getByText(date, { exact: true })).toHaveCount(1);
  await expect(detailSummary.getByText("昼", { exact: true })).toBeVisible();
  await expect(
    detailSummary.getByText(`${date} 09:00`, { exact: true }),
  ).toBeVisible();
  await expect(
    detailSummary.getByText(`${date} 18:00`, { exact: true }),
  ).toBeVisible();
  await expect(
    detailSummary.getByText("退勤済み", { exact: true }),
  ).toBeVisible();
}

async function assertAttendancePersisted(
  db: PostgresDatabase,
  attendanceId: string,
  expectation: AttendanceExpectation,
) {
  await expect
    .poll(async () => {
      const [currentState] = await db
        .select({
          userId: attendanceCurrentStates.userId,
          attendanceDate: attendanceCurrentStates.attendanceDate,
          workPeriod: attendanceCurrentStates.workPeriod,
          clockInAt: attendanceCurrentStates.clockInAt,
          clockOutAt: attendanceCurrentStates.clockOutAt,
        })
        .from(attendanceCurrentStates)
        .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
      return currentState
        ? {
            userId: currentState.userId,
            attendanceDate: currentState.attendanceDate,
            workPeriod: currentState.workPeriod,
            clockInAt: currentState.clockInAt.toISOString(),
            clockOutAt: currentState.clockOutAt?.toISOString() ?? null,
          }
        : null;
    })
    .toEqual({
      userId: expectation.userId,
      attendanceDate: expectation.attendanceDate,
      workPeriod: "day",
      clockInAt: expectation.clockInAt.toISOString(),
      clockOutAt: expectation.clockOutAt.toISOString(),
    });
}

async function assertDuplicateWasRejectedWithoutPartialEvents(
  db: PostgresDatabase,
  attendanceId: string,
  userId: string,
  attendanceDate: string,
  clockOutAt: Date,
) {
  await expect
    .poll(async () => {
      const states = await db
        .select({ attendanceId: attendanceCurrentStates.attendanceId })
        .from(attendanceCurrentStates)
        .where(
          and(
            eq(attendanceCurrentStates.userId, userId),
            eq(attendanceCurrentStates.attendanceDate, attendanceDate),
          ),
        );
      const clockInEvents = await db
        .select({ attendanceId: attendanceEvents.attendanceId })
        .from(attendanceEvents)
        .where(
          sql`${attendanceEvents.eventType} = 'AttendanceClockedIn' AND ${attendanceEvents.payload}->>'userId' = ${userId} AND ${attendanceEvents.payload}->>'attendanceDate' = ${attendanceDate}`,
        );
      const scopedAttendanceIds = clockInEvents.map(
        (event) => event.attendanceId,
      );
      const clockOutEvents =
        scopedAttendanceIds.length === 0
          ? []
          : await db
              .select({ attendanceId: attendanceEvents.attendanceId })
              .from(attendanceEvents)
              .where(
                and(
                  eq(attendanceEvents.eventType, "AttendanceClockedOut"),
                  sql`${attendanceEvents.payload}->>'clockOutAt' = ${clockOutAt.toISOString()}`,
                  inArray(attendanceEvents.attendanceId, scopedAttendanceIds),
                ),
              );
      const originalEvents = await db
        .select({ eventVersion: attendanceEvents.eventVersion })
        .from(attendanceEvents)
        .where(eq(attendanceEvents.attendanceId, attendanceId))
        .orderBy(asc(attendanceEvents.eventVersion));
      return {
        currentAttendanceIds: states.map((state) => state.attendanceId),
        clockInAttendanceIds: clockInEvents.map((event) => event.attendanceId),
        clockOutAttendanceIds: clockOutEvents.map(
          (event) => event.attendanceId,
        ),
        originalEventVersions: originalEvents.map(
          (event) => event.eventVersion,
        ),
      };
    })
    .toEqual({
      currentAttendanceIds: [attendanceId],
      clockInAttendanceIds: [attendanceId],
      clockOutAttendanceIds: [attendanceId],
      originalEventVersions: [1, 2],
    });
}

async function cleanupCreatedAttendances(
  db: PostgresDatabase,
  attendanceIds: readonly string[],
  testUserIds: readonly string[],
) {
  const ids = new Set(attendanceIds);
  for (const userId of testUserIds) {
    const states = await db
      .select({ attendanceId: attendanceCurrentStates.attendanceId })
      .from(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.userId, userId));
    for (const state of states) ids.add(state.attendanceId);
  }
  for (const attendanceId of ids) {
    await db
      .delete(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
    await db
      .delete(attendanceEvents)
      .where(eq(attendanceEvents.attendanceId, attendanceId));
  }
}

async function assertAdminAttendanceList(
  page: Page,
  displayName: string,
  userId: string,
  attendanceId: string,
  attendanceDate: string,
) {
  const query = `from=${TEST_FROM}&to=${TEST_TO}&userId=${userId}`;
  await page.goto(`/admin/attendance?${query}`);
  await expect(page).toHaveURL(`/admin/attendance?${query}`);
  const item = getAttendanceRow(page, displayName, attendanceDate);
  await expect(item).toHaveCount(1);
  await expect(getAttendanceDateGroup(page, attendanceDate)).toBeVisible();
  await expect(item).toContainText("09:00");
  await expect(item).toContainText("18:00");
  await expect(
    getAttendanceLink(page, displayName, attendanceDate),
  ).toHaveAttribute("href", `/admin/attendance/${attendanceId}?${query}`);
}

async function assertHistory(
  page: Page,
  attendances: readonly { attendanceDate: string }[],
) {
  await page.goto(`/history?month=${TEST_MONTH}`);
  await expect(page.getByRole("heading", { name: "2026年1月" })).toBeVisible();
  const main = page.getByRole("main");
  for (const attendance of attendances) {
    await expect(main).toContainText(
      `${Number(attendance.attendanceDate.slice(8))}日`,
    );
  }
  if (attendances.length > 0) {
    await expect(main).toContainText("09:00");
    await expect(main).toContainText("18:00");
  }
}

async function assertPayrollEstimateList(
  page: Page,
  displayNames: readonly string[],
) {
  await page.goto("/admin/payroll-estimates");
  const navigation = page.getByRole("group", {
    name: "給与見込み一覧の月ナビゲーション",
  });
  await navigation.getByRole("button", { name: "月を直接選択" }).click();
  const month = navigation.getByLabel("月を直接選択");
  await expect(month).toBeVisible();
  await month.fill(TEST_MONTH);
  const summaryList = page.getByRole("list", { name: "給与見込み一覧" });
  await expect(summaryList).toBeVisible();
  for (const displayName of displayNames) {
    const card = summaryList
      .getByRole("listitem")
      .filter({ hasText: displayName });
    await expect(card).toHaveCount(1);
    await expect(card.locator("p")).toContainText(/[0-9,]+円/);
    await expect(card).not.toContainText(/\d+時間/);
  }
}

async function setSessionCookie(context: BrowserContext, sessionId: string) {
  await context.clearCookies({ name: "timecard_session" });
  await context.addCookies([
    {
      name: "timecard_session",
      value: sessionId,
      url: "http://127.0.0.1:4173",
    },
  ]);
}

async function assertReadOnlyOtherAdminAttendanceDetail(
  page: Page,
  attendance: {
    attendanceDate: string;
    displayName: string;
  },
) {
  const detailSummary = page.getByRole("region", {
    name: "勤怠の現在状態",
  });
  const userContextCard = page.getByRole("region", { name: "対象ユーザー" });
  const date = formatAttendanceDateForDisplay(attendance.attendanceDate);
  await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
  await expect(
    userContextCard.getByText(attendance.displayName, { exact: true }),
  ).toHaveCount(1);
  await expect(detailSummary.getByText(date, { exact: true })).toHaveCount(1);
  await expect(
    detailSummary.getByText("退勤済み", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "訂正" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
}

async function seedAttendance({
  attendanceId,
  clockInAt,
  clockOutAt,
  attendanceDate,
  userId,
  performedByUserId = userId,
  db,
}: {
  attendanceId: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  attendanceDate: string;
  userId: string;
  performedByUserId?: string;
  db: PostgresDatabase;
}) {
  await db.transaction(async (tx) => {
    await tx.insert(attendanceEvents).values({
      attendanceId,
      performedByUserId,
      eventVersion: 1,
      eventType: "AttendanceClockedIn",
      payload: {
        userId,
        workPeriod: "day",
        attendanceDate,
        clockInAt: clockInAt.toISOString(),
      },
    });
    if (clockOutAt) {
      await tx.insert(attendanceEvents).values({
        attendanceId,
        performedByUserId,
        eventVersion: 2,
        eventType: "AttendanceClockedOut",
        payload: { clockOutAt: clockOutAt.toISOString() },
      });
    }
    await tx.insert(attendanceCurrentStates).values({
      attendanceId,
      userId,
      attendanceDate,
      workPeriod: "day",
      clockInAt,
      clockOutAt,
      eventVersion: clockOutAt ? 2 : 1,
    });
  });
}

async function cleanupAttendance(db: PostgresDatabase, attendanceId: string) {
  await db
    .delete(attendanceCurrentStates)
    .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
  await db
    .delete(attendanceEvents)
    .where(eq(attendanceEvents.attendanceId, attendanceId));
}

test("adminは勤務中勤怠を訂正してDBと詳細再表示へ反映する", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E訂正対象-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:00");
  const clockOutAt = testTokyoDateAt(0, "18:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);

  try {
    await seedAttendance({
      attendanceId,
      clockInAt,
      clockOutAt: null,
      attendanceDate,
      userId: staff.userId,
      db: staff.db,
    });
    await page.goto(`/admin/attendance/${attendanceId}`);
    await expect(page.getByText("勤務中", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "訂正" }).click();
    await page.getByLabel("訂正退勤日時").fill(`${attendanceDate}T18:00`);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}`);
    await expect(page.getByText("退勤済み", { exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const [state] = await staff.db
          .select({ clockOutAt: attendanceCurrentStates.clockOutAt })
          .from(attendanceCurrentStates)
          .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
        return state?.clockOutAt?.toISOString();
      })
      .toBe(clockOutAt.toISOString());

    await page.reload();
    await expect(page.getByText("退勤済み", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "勤怠の現在状態" })
        .getByText(`${attendanceDate.replaceAll("-", "/")} 18:00`, {
          exact: true,
        }),
    ).toBeVisible();
  } finally {
    await cleanupAttendance(staff.db, attendanceId);
    await staff.cleanup();
  }
});

test("adminはcompleted勤怠を全体取消してDBと詳細再表示へ反映する", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E取消対象-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:00");
  const clockOutAt = testTokyoDateAt(0, "18:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);

  try {
    await seedAttendance({
      attendanceId,
      clockInAt,
      clockOutAt,
      attendanceDate,
      userId: staff.userId,
      db: staff.db,
    });
    await page.goto(`/admin/attendance/${attendanceId}`);
    await expect(page.getByText("退勤済み", { exact: true })).toBeVisible();
    const initialReadiness = await assertAdminRouteReadiness(page);
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "取消する" }).click();
    await expect(
      page
        .getByRole("region", { name: "勤怠の現在状態" })
        .getByText("取消済み", { exact: true }),
    ).toBeVisible();
    await assertAdminRouteReadiness(
      page,
      initialReadiness.routeDataToken ?? undefined,
    );

    await expect
      .poll(async () => {
        const [state] = await staff.db
          .select({ isCancelled: attendanceCurrentStates.isCancelled })
          .from(attendanceCurrentStates)
          .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
        return state?.isCancelled;
      })
      .toBe(true);

    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "勤怠の現在状態" })
        .getByText("取消済み", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
  } finally {
    await cleanupAttendance(staff.db, attendanceId);
    await staff.cleanup();
  }
});

test("adminは勤怠一覧と詳細を行き来し、一覧の検索条件へ戻れる", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E詳細遷移対象-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:00");
  const attendanceDate = formatAttendanceDate(clockInAt);
  const attendanceId = randomUUID();
  const query = `from=${TEST_FROM}&to=${TEST_TO}&userId=${staff.userId}`;

  try {
    await seedAttendance({
      attendanceId,
      clockInAt,
      clockOutAt: null,
      attendanceDate,
      userId: staff.userId,
      db: staff.db,
    });
    await page.goto(`/admin/attendance?${query}`);
    const detailLink = getAttendanceLink(page, displayName, attendanceDate);
    await expect(detailLink).toBeVisible();
    await expect(detailLink).toHaveAttribute(
      "href",
      `/admin/attendance/${attendanceId}?${query}`,
    );
    await detailLink.click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}?${query}`);
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(`/admin/attendance?${query}`);
    await expect(
      getAttendanceLink(page, displayName, attendanceDate),
    ).toBeVisible();
    await getAttendanceLink(page, displayName, attendanceDate).click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}?${query}`);
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
  } finally {
    await cleanupAttendance(staff.db, attendanceId);
    await staff.cleanup();
  }
});

test("adminはworking勤怠を勤怠全体として取消できる", async ({
  page,
  admin,
}) => {
  const displayName = `E2E勤務中取消対象-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);
  const query = `from=${TEST_FROM}&to=${TEST_TO}&userId=${staff.userId}`;

  try {
    await staff.db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values({
        attendanceId,
        performedByUserId: staff.userId,
        eventVersion: 1,
        eventType: "AttendanceClockedIn",
        payload: {
          userId: staff.userId,
          workPeriod: "day",
          attendanceDate,
          clockInAt: clockInAt.toISOString(),
        },
      });
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId: staff.userId,
        attendanceDate,
        workPeriod: "day",
        clockInAt,
        clockOutAt: null,
        eventVersion: 1,
      });
    });

    await page.goto(`/admin/attendance?${query}`);
    await getAttendanceLink(page, displayName, attendanceDate).click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}?${query}`);
    await expect(page.getByText("勤務中", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "訂正" })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toBeVisible();

    await page.getByRole("button", { name: "取消" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("勤怠を取消")).toBeVisible();
    await expect(dialog).toContainText("取消後は元に戻せません。");
    await expect(dialog).toContainText(displayName);
    await expect(dialog).toContainText(
      formatAttendanceDateForDisplay(attendanceDate),
    );
    await expect(dialog).toContainText("昼");
    await page.getByRole("button", { name: "取消する" }).click();

    const summary = page.getByRole("region", { name: "勤怠の現在状態" });
    await expect(summary.getByText("取消済み", { exact: true })).toBeVisible();
    await expect(page.getByText("勤怠を取消", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "訂正" })).toHaveCount(0);

    await expect
      .poll(async () => {
        const events = await staff.db
          .select({ eventType: attendanceEvents.eventType })
          .from(attendanceEvents)
          .where(eq(attendanceEvents.attendanceId, attendanceId))
          .orderBy(asc(attendanceEvents.eventVersion));
        const [currentState] = await staff.db
          .select()
          .from(attendanceCurrentStates)
          .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
        return {
          eventTypes: events.map((event) => event.eventType),
          currentStateExists: currentState !== undefined,
        };
      })
      .toEqual({
        eventTypes: ["AttendanceClockedIn", "AttendanceCancelled"],
        currentStateExists: true,
      });
  } finally {
    await staff.db
      .delete(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
    await staff.db
      .delete(attendanceEvents)
      .where(
        or(
          eq(attendanceEvents.attendanceId, attendanceId),
          eq(attendanceEvents.performedByUserId, admin.userId),
        ),
      );
    await staff.cleanup();
  }
});

test("adminは長い名前と翌々日退勤の勤怠行を詳細表示できる", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E翌々日退勤-非常に長いスタッフ表示名-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:15");
  const clockOutAt = testTokyoDateAt(2, "18:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);
  const query = `from=${TEST_FROM}&to=${TEST_TO}&userId=${staff.userId}`;

  try {
    await staff.db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values([
        {
          attendanceId,
          performedByUserId: staff.userId,
          eventVersion: 1,
          eventType: "AttendanceClockedIn",
          payload: {
            userId: staff.userId,
            workPeriod: "day",
            attendanceDate,
            clockInAt: clockInAt.toISOString(),
          },
        },
        {
          attendanceId,
          performedByUserId: staff.userId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt: clockOutAt.toISOString() },
        },
      ]);
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId: staff.userId,
        attendanceDate,
        workPeriod: "day",
        clockInAt,
        clockOutAt,
        eventVersion: 2,
      });
    });

    await page.goto(`/admin/attendance?${query}`);
    const detailLink = getAttendanceLink(page, displayName, attendanceDate);

    await expect(getAttendanceDateGroup(page, attendanceDate)).toBeVisible();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}?${query}`);
  } finally {
    await staff.db
      .delete(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
    await staff.db
      .delete(attendanceEvents)
      .where(eq(attendanceEvents.attendanceId, attendanceId));
    await staff.cleanup();
  }
});

test("adminは勤怠一覧末尾の導線から専用の新規作成画面で勤怠を作成できる", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E新規作成対象-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(0, "09:00");
  const clockOutAt = testTokyoDateAt(0, "18:00");
  const attendanceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(clockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    await page.goto("/admin/attendance");
    const creationLink = page.getByRole("link", { name: "勤怠を新規作成" });
    await expect(creationLink).toBeVisible();
    await expect(creationLink).toHaveAttribute("href", "/admin/attendance/new");
    await creationLink.click();
    await expect(page).toHaveURL("/admin/attendance/new");
    await expect(page.getByRole("heading", { name: "勤怠作成" })).toBeVisible();
    await assertAdminRouteReadiness(page);

    await page.getByLabel("作成対象者").click();
    await page.getByRole("option", { name: displayName, exact: true }).click();
    await expect(page.getByLabel("作成対象者")).toHaveText(displayName);
    await page.getByText("昼", { exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "昼", exact: true }),
    ).toBeChecked();
    await page.getByLabel("作成出勤日時").fill(`${attendanceDate}T09:00`);
    await page.getByLabel("作成退勤日時").fill(`${attendanceDate}T18:00`);
    await page.getByRole("button", { name: "作成" }).click();

    await expect(page).toHaveURL(
      /\/admin\/attendance\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const createdAttendanceId = new URL(page.url()).pathname.match(
      /\/admin\/attendance\/([0-9a-f-]{36})$/i,
    )?.[1];
    if (!createdAttendanceId) {
      throw new Error("作成された勤怠IDを取得できません。");
    }
    createdAttendanceIds.push(createdAttendanceId);
    const attendance = { attendanceDate, clockInAt, clockOutAt };
    await assertCompletedAttendanceDetail(page, {
      ...attendance,
      displayName,
    });
    await assertAttendancePersisted(staff.db, createdAttendanceId, {
      ...attendance,
      userId: staff.userId,
    });

    await page.reload();
    await expect(page.getByText("退勤済み", { exact: true })).toBeVisible();
    await assertAdminAttendanceList(
      page,
      displayName,
      staff.userId,
      createdAttendanceId,
      attendanceDate,
    );
  } finally {
    await cleanupCreatedAttendances(staff.db, createdAttendanceIds, [
      staff.userId,
    ]);
    await staff.cleanup();
  }
});

test("admin本人の勤怠作成は詳細へ反映し、同日の重複を拒否する", async ({
  page,
  admin,
}) => {
  const databaseAdmin = await createAuthenticatedUser({
    displayName: `E2E DB確認管理者-${randomUUID()}`,
    role: "admin",
    status: "active",
  });
  const adminClockInAt = testTokyoDateAt(2, "09:00");
  const adminClockOutAt = testTokyoDateAt(2, "18:00");
  const adminAttendanceDate = formatAttendanceDate(adminClockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const adminDisplayName = await readDisplayName(
      databaseAdmin.db,
      admin.userId,
    );
    const adminAttendance = await createAttendanceThroughForm({
      attendanceDate: adminAttendanceDate,
      clockInAt: adminClockInAt,
      clockOutAt: adminClockOutAt,
      displayName: adminDisplayName,
      page,
    });
    createdAttendanceIds.push(adminAttendance.attendanceId);
    await assertCompletedAttendanceDetail(page, {
      ...adminAttendance,
      displayName: adminDisplayName,
    });
    await assertAttendancePersisted(
      databaseAdmin.db,
      adminAttendance.attendanceId,
      {
        ...adminAttendance,
        userId: admin.userId,
      },
    );

    await page.goto("/admin/attendance/new");
    await page.getByLabel("作成対象者").click();
    await page
      .getByRole("option", { name: adminDisplayName, exact: true })
      .click();
    await page.getByText("昼", { exact: true }).click();
    await page.getByLabel("作成出勤日時").fill(`${adminAttendanceDate}T09:00`);
    await page.getByLabel("作成退勤日時").fill(`${adminAttendanceDate}T18:00`);
    await page.getByRole("button", { name: "作成" }).click();
    const overlapError = page
      .getByRole("alert")
      .filter({ hasText: ATTENDANCE_OVERLAP_MESSAGE });
    await expect(overlapError).toHaveCount(1);
    await expect(overlapError).toContainText(ATTENDANCE_OVERLAP_MESSAGE);
    await expect(page).toHaveURL("/admin/attendance/new");
    await assertDuplicateWasRejectedWithoutPartialEvents(
      databaseAdmin.db,
      adminAttendance.attendanceId,
      admin.userId,
      adminAttendanceDate,
      adminClockOutAt,
    );
  } finally {
    try {
      await cleanupCreatedAttendances(
        databaseAdmin.db,
        createdAttendanceIds,
        [],
      );
    } finally {
      await databaseAdmin.cleanup();
    }
  }
});

test("別管理者が作成した勤怠を一覧から参照し、詳細を読み取り専用で表示する", async ({
  page,
  admin,
}) => {
  const otherAdmin = await createAuthenticatedUser({
    displayName: `E2E別管理者-${randomUUID()}`,
    role: "admin",
    status: "active",
  });
  const clockInAt = testTokyoDateAt(3, "09:00");
  const clockOutAt = testTokyoDateAt(3, "18:00");
  const attendanceDate = formatAttendanceDate(clockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const displayName = await readDisplayName(otherAdmin.db, otherAdmin.userId);
    await setSessionCookie(page.context(), otherAdmin.sessionId);
    const attendance = await createAttendanceThroughForm({
      attendanceDate,
      clockInAt,
      clockOutAt,
      displayName,
      page,
    });
    createdAttendanceIds.push(attendance.attendanceId);
    await assertAttendancePersisted(otherAdmin.db, attendance.attendanceId, {
      ...attendance,
      userId: otherAdmin.userId,
    });

    await setSessionCookie(
      page.context(),
      (admin as typeof admin & { sessionId: string }).sessionId,
    );
    await assertAdminAttendanceList(
      page,
      displayName,
      otherAdmin.userId,
      attendance.attendanceId,
      attendanceDate,
    );
    await page.goto(
      `/admin/attendance/${attendance.attendanceId}?from=${TEST_FROM}&to=${TEST_TO}&userId=${otherAdmin.userId}`,
    );
    await assertReadOnlyOtherAdminAttendanceDetail(page, {
      ...attendance,
      displayName,
    });
  } finally {
    try {
      await cleanupCreatedAttendances(otherAdmin.db, createdAttendanceIds, [
        otherAdmin.userId,
      ]);
    } finally {
      await otherAdmin.cleanup();
    }
  }
});

test("管理者が作成した勤怠を給与見込み一覧へ反映する", async ({
  page,
  admin,
}) => {
  const otherAdmin = await createAuthenticatedUser({
    displayName: `E2E給与見込み別管理者-${randomUUID()}`,
    role: "admin",
    status: "active",
  });
  const adminClockInAt = testTokyoDateAt(2, "09:00");
  const adminClockOutAt = testTokyoDateAt(2, "18:00");
  const otherClockInAt = testTokyoDateAt(3, "09:00");
  const otherClockOutAt = testTokyoDateAt(3, "18:00");
  const adminDate = formatAttendanceDate(adminClockInAt);
  const otherDate = formatAttendanceDate(otherClockInAt);
  const attendanceIds: string[] = [];

  try {
    const adminName = await readDisplayName(otherAdmin.db, admin.userId);
    const otherName = await readDisplayName(otherAdmin.db, otherAdmin.userId);
    const adminAttendance = await createAttendanceThroughForm({
      attendanceDate: adminDate,
      clockInAt: adminClockInAt,
      clockOutAt: adminClockOutAt,
      displayName: adminName,
      page,
    });
    attendanceIds.push(adminAttendance.attendanceId);
    await assertAttendancePersisted(
      otherAdmin.db,
      adminAttendance.attendanceId,
      {
        ...adminAttendance,
        userId: admin.userId,
      },
    );

    await setSessionCookie(page.context(), otherAdmin.sessionId);
    const otherAttendance = await createAttendanceThroughForm({
      attendanceDate: otherDate,
      clockInAt: otherClockInAt,
      clockOutAt: otherClockOutAt,
      displayName: otherName,
      page,
    });
    attendanceIds.push(otherAttendance.attendanceId);
    await assertAttendancePersisted(
      otherAdmin.db,
      otherAttendance.attendanceId,
      {
        ...otherAttendance,
        userId: otherAdmin.userId,
      },
    );

    await setSessionCookie(
      page.context(),
      (admin as typeof admin & { sessionId: string }).sessionId,
    );
    await assertPayrollEstimateList(page, [adminName, otherName]);
  } finally {
    try {
      await cleanupCreatedAttendances(otherAdmin.db, attendanceIds, []);
    } finally {
      await otherAdmin.cleanup();
    }
  }
});

test("staffからadminへ変更後も過去勤怠と新規勤怠を管理一覧へ表示できる", async ({
  page,
  admin,
}) => {
  const targetDisplayName = `E2Eロール変更対象-${randomUUID()}`;
  const target = await createAuthenticatedUser({
    displayName: targetDisplayName,
    role: "staff",
    status: "active",
  });
  const firstClockInAt = testTokyoDateAt(4, "09:00");
  const firstClockOutAt = testTokyoDateAt(4, "18:00");
  const secondClockInAt = testTokyoDateAt(5, "09:00");
  const secondClockOutAt = testTokyoDateAt(5, "18:00");
  const firstAttendanceDate = formatAttendanceDate(firstClockInAt);
  const secondAttendanceDate = formatAttendanceDate(secondClockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const firstAttendance = await createAttendanceThroughForm({
      attendanceDate: firstAttendanceDate,
      clockInAt: firstClockInAt,
      clockOutAt: firstClockOutAt,
      displayName: targetDisplayName,
      page,
    });
    createdAttendanceIds.push(firstAttendance.attendanceId);
    await assertCompletedAttendanceDetail(page, {
      ...firstAttendance,
      displayName: targetDisplayName,
    });
    await assertAttendancePersisted(target.db, firstAttendance.attendanceId, {
      ...firstAttendance,
      userId: target.userId,
    });

    await target.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, target.userId));
    await expect
      .poll(async () => {
        const [user] = await target.db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, target.userId));
        return user?.role;
      })
      .toBe("admin");

    await setSessionCookie(page.context(), target.sessionId);
    const secondAttendance = await createAttendanceThroughForm({
      attendanceDate: secondAttendanceDate,
      clockInAt: secondClockInAt,
      clockOutAt: secondClockOutAt,
      displayName: targetDisplayName,
      page,
    });
    createdAttendanceIds.push(secondAttendance.attendanceId);
    expect(secondAttendance.attendanceId).not.toBe(
      firstAttendance.attendanceId,
    );
    await assertCompletedAttendanceDetail(page, {
      ...secondAttendance,
      displayName: targetDisplayName,
    });
    await assertAttendancePersisted(target.db, secondAttendance.attendanceId, {
      ...secondAttendance,
      userId: target.userId,
    });

    const query = `from=${TEST_FROM}&to=${TEST_TO}&userId=${target.userId}`;
    await setSessionCookie(
      page.context(),
      (admin as typeof admin & { sessionId: string }).sessionId,
    );
    await page.goto(`/admin/attendance?${query}`);
    await expect(page).toHaveURL(`/admin/attendance?${query}`);
    for (const attendance of [firstAttendance, secondAttendance]) {
      const item = getAttendanceRow(
        page,
        targetDisplayName,
        attendance.attendanceDate,
      );
      await expect(item).toHaveCount(1);
      await expect(item).toContainText("09:00");
      await expect(item).toContainText("18:00");
      await expect(
        getAttendanceLink(page, targetDisplayName, attendance.attendanceDate),
      ).toHaveAttribute(
        "href",
        `/admin/attendance/${attendance.attendanceId}?${query}`,
      );
    }

    for (const attendance of [firstAttendance, secondAttendance]) {
      await page.goto(`/admin/attendance/${attendance.attendanceId}?${query}`);
      await assertReadOnlyOtherAdminAttendanceDetail(page, {
        ...attendance,
        displayName: targetDisplayName,
      });
    }
  } finally {
    try {
      await cleanupCreatedAttendances(target.db, createdAttendanceIds, [
        target.userId,
      ]);
    } finally {
      await target.cleanup();
    }
  }
});

test("staffからadminへ変更後も過去勤怠と新規勤怠を本人履歴に表示できる", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E履歴ロール変更-${randomUUID()}`;
  const target = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const firstClockInAt = testTokyoDateAt(4, "09:00");
  const firstClockOutAt = testTokyoDateAt(4, "18:00");
  const secondClockInAt = testTokyoDateAt(5, "09:00");
  const secondClockOutAt = testTokyoDateAt(5, "18:00");
  const firstAttendanceDate = formatAttendanceDate(firstClockInAt);
  const secondAttendanceDate = formatAttendanceDate(secondClockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const firstAttendance = await createAttendanceThroughForm({
      attendanceDate: firstAttendanceDate,
      clockInAt: firstClockInAt,
      clockOutAt: firstClockOutAt,
      displayName,
      page,
    });
    createdAttendanceIds.push(firstAttendance.attendanceId);
    await assertAttendancePersisted(target.db, firstAttendance.attendanceId, {
      ...firstAttendance,
      userId: target.userId,
    });
    await target.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, target.userId));
    await expect
      .poll(async () => {
        const [user] = await target.db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, target.userId));
        return user?.role;
      })
      .toBe("admin");

    await setSessionCookie(page.context(), target.sessionId);
    const secondAttendance = await createAttendanceThroughForm({
      attendanceDate: secondAttendanceDate,
      clockInAt: secondClockInAt,
      clockOutAt: secondClockOutAt,
      displayName,
      page,
    });
    createdAttendanceIds.push(secondAttendance.attendanceId);
    await assertAttendancePersisted(target.db, secondAttendance.attendanceId, {
      ...secondAttendance,
      userId: target.userId,
    });

    await target.setSessionCookie(page.context());
    await assertHistory(page, [
      { attendanceDate: firstAttendanceDate },
      { attendanceDate: secondAttendanceDate },
    ]);
  } finally {
    try {
      await cleanupCreatedAttendances(target.db, createdAttendanceIds, [
        target.userId,
      ]);
    } finally {
      await target.cleanup();
    }
  }
});
