import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { attendanceCurrentStates, attendanceEvents, users } from "@repo/db";
import type { PostgresDatabase } from "@repo/platform";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { e2eTokyoDateAt } from "../reference-time";
import { expect, test } from "./support/admin-fixture";
import { createAuthenticatedUser } from "./support/authenticated-user-fixture";

const E2E_MONTH = "2026-01";
const E2E_FROM = `${E2E_MONTH}-01`;
const E2E_TO = `${E2E_MONTH}-31`;
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

async function expectAdminFrame(page: Page) {
  const viewport = page.viewportSize();
  const header = page.locator("header");
  const navigation = page.getByRole("navigation", {
    name: "管理画面のメインナビゲーション",
  });
  const selectedItem = navigation.locator('[aria-current="page"]');
  const commonFrame = page.locator("header + div");
  await expect(header).toHaveCount(1);
  await expect(navigation).toBeVisible();
  await expect(selectedItem).toHaveText("勤怠");
  await expect(selectedItem).not.toHaveAttribute("href");
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "管理メニュー" })).toHaveCount(
    0,
  );
  await expect(commonFrame).toBeVisible();
  await expect(commonFrame.getByRole("main")).toHaveCount(1);
  const navigationBox = await navigation.boundingBox();
  const headerBox = await header.boundingBox();
  const frameBox = await commonFrame.boundingBox();
  if (!viewport || !navigationBox || !headerBox || !frameBox) {
    throw new Error("管理画面の共通枠とタブの表示寸法を取得できません。");
  }
  expect(Math.abs(navigationBox.x - headerBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(navigationBox.width - headerBox.width)).toBeLessThanOrEqual(
    1,
  );
  expect(Math.abs(headerBox.x - frameBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(headerBox.width - frameBox.width)).toBeLessThanOrEqual(1);
  expect(frameBox.width).toBeLessThanOrEqual(448);
  expect(
    Math.abs(frameBox.x - (viewport.width - frameBox.width) / 2),
  ).toBeLessThanOrEqual(1);
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
  operatorDisplayName: string,
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

  const history = page.getByRole("heading", { name: "変更履歴" }).locator("..");
  await expect(history.getByText(/出勤を記録（/)).toBeVisible();
  await expect(history.getByText(/退勤を記録（/)).toBeVisible();
  await expect(
    history.getByText(`操作者：${operatorDisplayName}`, { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByRole("link", { name: "訂正" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
}

async function assertAttendancePersisted(
  db: PostgresDatabase,
  attendanceId: string,
  executorUserId: string,
  expectation: AttendanceExpectation,
) {
  await expect
    .poll(async () => {
      const [currentState] = await db
        .select()
        .from(attendanceCurrentStates)
        .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
      const events = await db
        .select()
        .from(attendanceEvents)
        .where(eq(attendanceEvents.attendanceId, attendanceId))
        .orderBy(asc(attendanceEvents.eventVersion));
      return {
        currentStateCount: currentState ? 1 : 0,
        eventTypes: events.map((event) => event.eventType),
      };
    })
    .toEqual({
      currentStateCount: 1,
      eventTypes: ["AttendanceClockedIn", "AttendanceClockedOut"],
    });

  const events = await db
    .select()
    .from(attendanceEvents)
    .where(eq(attendanceEvents.attendanceId, attendanceId))
    .orderBy(asc(attendanceEvents.eventVersion));
  expect(events.map((event) => event.eventVersion)).toEqual([1, 2]);
  expect(
    events.every((event) => event.performedByUserId === executorUserId),
  ).toBe(true);
  const [clockInEvent] = events;
  if (!clockInEvent) throw new Error("出勤イベントを取得できませんでした。");
  expect((clockInEvent.payload as { userId?: unknown }).userId).toBe(
    expectation.userId,
  );

  const [currentState] = await db
    .select()
    .from(attendanceCurrentStates)
    .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
  expect(currentState).toMatchObject({
    attendanceId,
    userId: expectation.userId,
    attendanceDate: expectation.attendanceDate,
    workPeriod: "day",
    eventVersion: 2,
  });
  expect(currentState?.clockInAt.getTime()).toBe(
    expectation.clockInAt.getTime(),
  );
  expect(currentState?.clockOutAt?.getTime()).toBe(
    expectation.clockOutAt.getTime(),
  );
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
  const query = `from=${E2E_FROM}&to=${E2E_TO}&userId=${userId}`;
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
  await page.goto(`/history?month=${E2E_MONTH}`);
  await expect(page.getByRole("heading", { name: "2026年1月" })).toBeVisible();
  const main = page.getByRole("main");
  for (const attendance of attendances) {
    await expect(main).toContainText(
      `${Number(attendance.attendanceDate.slice(8))}日`,
    );
  }
  await expect(main).toContainText("09:00");
  await expect(main).toContainText("18:00");
}

async function assertPayrollList(
  page: Page,
  summaries: readonly { displayName: string }[],
) {
  await page.goto("/admin/payroll");
  const navigation = page.getByRole("group", {
    name: "給与一覧の月ナビゲーション",
  });
  await navigation.getByRole("button", { name: "月を直接選択" }).click();
  const month = navigation.getByLabel("月を直接選択");
  await expect(month).toBeVisible();
  await month.fill(E2E_MONTH);
  const summaryList = page.getByRole("list", { name: "給与一覧" });
  await expect(summaryList).toBeVisible();
  for (const summary of summaries) {
    const card = summaryList
      .getByRole("listitem")
      .filter({ hasText: summary.displayName });
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
    clockInAt: Date;
    clockOutAt: Date;
    displayName: string;
  },
  operatorDisplayName: string,
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

  const history = page.getByRole("heading", { name: "変更履歴" }).locator("..");
  await expect(history.getByText(/出勤を記録（/)).toBeVisible();
  await expect(history.getByText(/退勤を記録（/)).toBeVisible();
  await expect(
    history.getByText(`操作者：${operatorDisplayName}`, { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByRole("link", { name: "訂正" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
}

test("長い表示名でも勤怠取消ダイアログを画面内で確認できる", async ({
  page,
  admin: _admin,
}, testInfo) => {
  const displayName = `LongDisplayName${"A".repeat(80)}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  let attendanceId: string | undefined;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const clockInAt = e2eTokyoDateAt(2, "09:00");
    const clockOutAt = e2eTokyoDateAt(2, "18:00");
    const attendanceDate = formatAttendanceDate(clockInAt);
    const attendance = await createAttendanceThroughForm({
      attendanceDate,
      clockInAt,
      clockOutAt,
      displayName,
      page,
    });
    attendanceId = attendance.attendanceId;

    const cancelButton = page.getByRole("button", { name: "取消" });
    await cancelButton.click();
    const dialog = page.getByRole("dialog");
    const displayNameValue = dialog.locator("dd").first();
    const cancelDialogButton = dialog.getByRole("button", {
      name: "キャンセル",
    });
    const confirmButton = dialog.getByRole("button", { name: "取消する" });
    const assertDialogFitsViewport = async () => {
      await expect(dialog).toBeVisible();
      await expect(displayNameValue).toHaveText(displayName);
      const viewport = page.viewportSize();
      const dialogBox = await dialog.boundingBox();
      const detailsBox = await dialog.locator("dl").boundingBox();
      const displayNameBox = await displayNameValue.boundingBox();
      const cancelBox = await cancelDialogButton.boundingBox();
      const confirmBox = await confirmButton.boundingBox();
      const valueFits = await displayNameValue.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      );
      const documentFits = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      expect(viewport).not.toBeNull();
      if (
        !viewport ||
        !dialogBox ||
        !detailsBox ||
        !displayNameBox ||
        !cancelBox ||
        !confirmBox
      ) {
        throw new Error("確認ダイアログの表示寸法を取得できません。");
      }
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
      expect(detailsBox.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
        dialogBox.x + dialogBox.width,
      );
      expect(displayNameBox.x).toBeGreaterThanOrEqual(detailsBox.x);
      expect(displayNameBox.x + displayNameBox.width).toBeLessThanOrEqual(
        detailsBox.x + detailsBox.width,
      );
      for (const buttonBox of [cancelBox, confirmBox]) {
        expect(buttonBox.x).toBeGreaterThanOrEqual(0);
        expect(buttonBox.y).toBeGreaterThanOrEqual(0);
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      expect(valueFits).toBe(true);
      expect(documentFits).toBe(true);
      await expect(cancelDialogButton).toBeVisible();
      await expect(confirmButton).toBeVisible();
    };

    await assertDialogFitsViewport();
    await page.reload();
    await page.getByRole("button", { name: "取消" }).click();
    await assertDialogFitsViewport();
    await page.screenshot({
      path: testInfo.outputPath("attendance-cancel-dialog.png"),
      animations: "disabled",
    });
    await cancelDialogButton.click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "取消" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "取消する",
      })
      .click();
    await expect(page.getByText("取消済み", { exact: true })).toBeVisible();
  } finally {
    if (attendanceId) {
      await cleanupCreatedAttendances(staff.db, [attendanceId], [staff.userId]);
    }
    await staff.cleanup();
  }
});

test("adminは勤務中勤怠を訂正し、completed勤怠を全体取消できる", async ({
  page,
  admin,
}) => {
  const displayName = `E2E訂正対象-とても長いスタッフ表示名-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const clockInAt = e2eTokyoDateAt(0, "09:00");
  const attendanceId = randomUUID();
  const attendanceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(clockInAt);

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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/attendance");
    await page.getByRole("button", { name: "検索条件を開く" }).click();
    await page.getByLabel("利用者").click();
    await page.getByRole("option", { name: displayName, exact: true }).click();
    await expect(page.getByLabel("利用者")).toHaveText(displayName);
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/attendance\?from=.*&to=.*&userId=/);
    const listUrl = new URL(page.url());
    const canonicalQuery = listUrl.search;
    const attendanceList = page.getByRole("list", { name: "勤怠一覧" });
    let detailLink = getAttendanceLink(page, displayName, attendanceDate);
    let item = detailLink.locator("..");

    await expect(attendanceList).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(
      detailLink.locator('[data-attendance-time-part="clock-in"]'),
    ).toHaveText("09:00");
    await expect(
      detailLink.locator('[data-attendance-time-part="separator"]'),
    ).toHaveText("-");
    await expect(
      detailLink.locator('[data-attendance-time-part="clock-out"]'),
    ).toHaveText("");
    await expect(detailLink).not.toContainText("勤務中");
    await expect(detailLink).toHaveAttribute("aria-label", /09:00 - 勤務中/);
    await expect(item.getByText("詳細と操作")).toHaveCount(0);
    await expect(item.getByRole("button", { name: "訂正" })).toHaveCount(0);
    await expect(detailLink).toHaveAttribute(
      "href",
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );

    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await detailLink.focus();
    await expect(detailLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );
    await page.goto(`/admin/attendance${canonicalQuery}`);
    detailLink = getAttendanceLink(page, displayName, attendanceDate);
    item = detailLink.locator("..");

    await detailLink.click();
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`/admin/attendance${canonicalQuery}`);
    await expect(
      getAttendanceLink(page, displayName, attendanceDate),
    ).toBeVisible();
    await getAttendanceLink(page, displayName, attendanceDate).click();
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    await expectAdminFrame(page);
    const detailSummary = page.getByRole("region", {
      name: "勤怠の現在状態",
    });
    const userContextCard = page.getByRole("region", {
      name: "対象ユーザー",
    });
    await expect(
      userContextCard.getByText(displayName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      detailSummary.getByText(displayName, { exact: true }),
    ).toHaveCount(0);
    await expect(
      detailSummary.getByText(attendanceDate.replaceAll("-", "/"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("昼")).toBeVisible();
    await expect(page.getByText("勤務中")).toBeVisible();
    await expect(page.getByText(/出勤を記録（/)).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.getByRole("link", { name: "訂正" }).click();
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}/edit${canonicalQuery}`,
    );
    await expect(page.getByRole("heading", { name: "勤怠訂正" })).toBeVisible();
    await expectAdminFrame(page);
    const correctionSummary = page.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    const correctionUserContextCard = page.getByRole("region", {
      name: "対象ユーザー",
    });
    await expect(
      correctionUserContextCard.getByText(displayName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      correctionSummary.getByText(displayName, { exact: true }),
    ).toHaveCount(0);
    await expect(
      correctionSummary.getByText(attendanceDate.replaceAll("-", "/"), {
        exact: true,
      }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByLabel("訂正退勤日時").fill(`${attendanceDate}T18:00`);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );
    await expect(page.getByText("退勤済み")).toBeVisible();
    await expect(
      detailSummary.getByText(`${attendanceDate.replaceAll("-", "/")} 18:00`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/退勤を記録（/)).toBeVisible();
    const cancelButton = page.getByRole("button", { name: "取消" });
    await cancelButton.click();
    const cancellationDialog = page.getByRole("dialog");
    await expect(cancellationDialog).toBeVisible();
    await expect(cancellationDialog.getByText("勤怠を取消")).toBeVisible();
    await expect(cancellationDialog).toContainText("取消後は元に戻せません。");
    await expect(cancellationDialog).toContainText(displayName);
    await expect(cancellationDialog).toContainText(
      attendanceDate.replaceAll("-", "/"),
    );
    await expect(cancellationDialog).toContainText("昼");
    await expect(cancellationDialog).not.toContainText("退勤のみ");
    await expect(cancellationDialog).not.toContainText("勤務全体");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(cancellationDialog).toBeHidden();
    await expect(cancelButton).toBeFocused();

    await cancelButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消する" }).click();
    await expect(detailSummary.getByText("取消済み")).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "訂正" })).toHaveCount(0);
    await expect(page.getByText("勤怠を取消", { exact: true })).toBeVisible();

    await page.goto(`/admin/attendance${canonicalQuery}`);
    await expect(page).toHaveURL(`/admin/attendance${canonicalQuery}`);
    await expect(
      getAttendanceRow(page, displayName, attendanceDate),
    ).toContainText("取消済み");

    await page.goto(`/admin/attendance${canonicalQuery}`);

    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(
      getAttendanceLink(page, displayName, attendanceDate),
    ).toBeVisible();
    await getAttendanceLink(page, displayName, attendanceDate).click();
    await expect(page).toHaveURL(
      `/admin/attendance/${attendanceId}${canonicalQuery}`,
    );
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    await expectAdminFrame(page);
    await page.goto(`/admin/attendance/${attendanceId}${canonicalQuery}`);
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    await expect(page.getByText("勤怠を取消", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);

    await expect
      .poll(async () => {
        const events = await staff.db
          .select({ eventType: attendanceEvents.eventType })
          .from(attendanceEvents)
          .where(eq(attendanceEvents.attendanceId, attendanceId))
          .orderBy(asc(attendanceEvents.eventVersion));

        return events.map((event) => event.eventType);
      })
      .toEqual([
        "AttendanceClockedIn",
        "AttendanceClockedOut",
        "AttendanceCancelled",
      ]);
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
  const clockInAt = e2eTokyoDateAt(0, "09:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);
  const query = `from=${E2E_FROM}&to=${E2E_TO}&userId=${staff.userId}`;

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

test("adminは320pxでも長い名前と翌々日退勤の勤怠行を操作できる", async ({
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
  const clockInAt = e2eTokyoDateAt(0, "09:15");
  const clockOutAt = e2eTokyoDateAt(2, "18:00");
  const attendanceId = randomUUID();
  const attendanceDate = formatAttendanceDate(clockInAt);
  const query = `from=${E2E_FROM}&to=${E2E_TO}&userId=${staff.userId}`;

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

    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/admin/attendance?${query}`);
    const detailLink = getAttendanceLink(page, displayName, attendanceDate);
    const name = detailLink.getByText(displayName, { exact: true });

    await expect(getAttendanceDateGroup(page, attendanceDate)).toBeVisible();
    await expect(detailLink).toBeVisible();
    await expect(name).toBeVisible();
    await expect(detailLink).toContainText("18:00");
    await expect(detailLink).not.toContainText(/\d{4}\/\d{2}\/\d{2}/);
    await expect(detailLink).toHaveAttribute(
      "aria-label",
      new RegExp(`${attendanceDate.replaceAll("-", "/")}.*09:15 - 18:00`),
    );
    await expect(detailLink).not.toHaveAttribute("aria-label", /2026\/01\/03/);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await detailLink.focus();
    await expect(detailLink).toBeFocused();
    await page.keyboard.press("Enter");
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
  const clockInAt = e2eTokyoDateAt(0, "09:00");
  const attendanceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(clockInAt);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/attendance");
    await page.getByRole("button", { name: "検索条件を開く" }).click();
    const period = page.getByRole("group", { name: "期間" });
    await expect(period).toBeVisible();
    await expect(period.getByLabel("開始日")).toBeVisible();
    await expect(period.getByLabel("終了日")).toBeVisible();
    await expect(page.getByLabel("利用者")).toHaveText("全員");
    const workPeriod = page.getByRole("group", { name: "勤務区分" });
    await expect(
      workPeriod.getByRole("radio", { name: "すべて" }),
    ).toBeChecked();
    await expect(page.getByLabel("状態")).toHaveText("すべて");
    const listUrlBeforeWorkPeriod = page.url();
    for (const name of ["昼", "夜", "すべて"]) {
      const choice = workPeriod.getByRole("radio", { name });
      const optionLabel = workPeriod.getByText(name, { exact: true });
      await expect(optionLabel).toBeVisible();
      await optionLabel.click();
      await expect(choice).toBeChecked();
      await expect(page).toHaveURL(listUrlBeforeWorkPeriod);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByLabel("利用者").click();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByRole("option", { name: displayName, exact: true }).click();
    await expect(page.getByLabel("利用者")).toHaveText(displayName);
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/attendance\?from=.*&to=.*&userId=/);
    await page.getByRole("button", { name: "検索条件を開く" }).click();
    await expect(page.getByLabel("利用者")).toHaveText(displayName);
    const listUrl = new URL(page.url());
    const canonicalQuery = listUrl.search;
    const creationLink = page.getByRole("link", { name: "勤怠を新規作成" });
    await expect(creationLink).toHaveAttribute("href", "/admin/attendance/new");
    await creationLink.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL("/admin/attendance/new");
    await expect(page.getByRole("heading", { name: "勤怠作成" })).toBeVisible();
    await expect(page.getByLabel("作成対象者")).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "作成勤務区分" }),
    ).toBeVisible();
    await expect(page.getByLabel("作成出勤日時")).toBeVisible();
    await expect(page.getByLabel("作成退勤日時")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

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

    await expect(page).toHaveURL(/\/admin\/attendance\/[^/]+$/);
    const createdAttendanceId = new URL(page.url()).pathname.split("/").pop();
    if (!createdAttendanceId) {
      throw new Error("作成された勤怠IDを取得できません。");
    }
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    const detailSummary = page.getByRole("region", {
      name: "勤怠の現在状態",
    });
    const userContextCard = page.getByRole("region", {
      name: "対象ユーザー",
    });
    await expect(
      userContextCard.getByText(displayName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      detailSummary.getByText(displayName, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("退勤済み")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(`/admin/attendance${canonicalQuery}`);
    await expect(
      getAttendanceRow(page, displayName, attendanceDate),
    ).toContainText("18:00");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/admin/attendance/new${canonicalQuery}`);
    await expect(page.getByRole("heading", { name: "勤怠作成" })).toBeVisible();
    await expect(page.getByLabel("作成対象者")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    const createdAttendances = await staff.db
      .select({ attendanceId: attendanceCurrentStates.attendanceId })
      .from(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.userId, staff.userId));
    await staff.db
      .delete(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.userId, staff.userId));
    for (const attendance of createdAttendances) {
      await staff.db
        .delete(attendanceEvents)
        .where(eq(attendanceEvents.attendanceId, attendance.attendanceId));
    }
    await staff.cleanup();
  }
});

test("adminは本人と別管理者の勤怠を作成し、重複作成を拒否する", async ({
  page,
  admin,
}) => {
  const otherAdmin = await createAuthenticatedUser({
    displayName: `E2E別管理者-${randomUUID()}`,
    role: "admin",
    status: "active",
  });
  const adminClockInAt = e2eTokyoDateAt(2, "09:00");
  const adminClockOutAt = e2eTokyoDateAt(2, "18:00");
  const otherAdminClockInAt = e2eTokyoDateAt(3, "09:00");
  const otherAdminClockOutAt = e2eTokyoDateAt(3, "18:00");
  const adminAttendanceDate = formatAttendanceDate(adminClockInAt);
  const otherAdminAttendanceDate = formatAttendanceDate(otherAdminClockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const adminDisplayName = await readDisplayName(otherAdmin.db, admin.userId);
    const otherAdminDisplayName = await readDisplayName(
      otherAdmin.db,
      otherAdmin.userId,
    );
    const adminAttendance = await createAttendanceThroughForm({
      attendanceDate: adminAttendanceDate,
      clockInAt: adminClockInAt,
      clockOutAt: adminClockOutAt,
      displayName: adminDisplayName,
      page,
    });
    createdAttendanceIds.push(adminAttendance.attendanceId);
    await assertCompletedAttendanceDetail(
      page,
      { ...adminAttendance, displayName: adminDisplayName },
      adminDisplayName,
    );
    await assertAttendancePersisted(
      otherAdmin.db,
      adminAttendance.attendanceId,
      admin.userId,
      { ...adminAttendance, userId: admin.userId },
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
      otherAdmin.db,
      adminAttendance.attendanceId,
      admin.userId,
      adminAttendanceDate,
      adminClockOutAt,
    );

    await page.getByLabel("作成対象者").click();
    await expect(
      page.getByRole("option", { name: otherAdminDisplayName, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await setSessionCookie(page.context(), otherAdmin.sessionId);
    const otherAdminAttendance = await createAttendanceThroughForm({
      attendanceDate: otherAdminAttendanceDate,
      clockInAt: otherAdminClockInAt,
      clockOutAt: otherAdminClockOutAt,
      displayName: otherAdminDisplayName,
      page,
    });
    createdAttendanceIds.push(otherAdminAttendance.attendanceId);
    await assertCompletedAttendanceDetail(
      page,
      { ...otherAdminAttendance, displayName: otherAdminDisplayName },
      otherAdminDisplayName,
    );
    await assertAttendancePersisted(
      otherAdmin.db,
      otherAdminAttendance.attendanceId,
      otherAdmin.userId,
      { ...otherAdminAttendance, userId: otherAdmin.userId },
    );

    await setSessionCookie(
      page.context(),
      (admin as typeof admin & { sessionId: string }).sessionId,
    );
    await assertAdminAttendanceList(
      page,
      adminDisplayName,
      admin.userId,
      adminAttendance.attendanceId,
      adminAttendanceDate,
    );
    await assertAdminAttendanceList(
      page,
      otherAdminDisplayName,
      otherAdmin.userId,
      otherAdminAttendance.attendanceId,
      otherAdminAttendanceDate,
    );
    const otherAdminQuery = `from=${E2E_FROM}&to=${E2E_TO}&userId=${otherAdmin.userId}`;
    await page.goto(
      `/admin/attendance/${otherAdminAttendance.attendanceId}?${otherAdminQuery}`,
    );
    await assertReadOnlyOtherAdminAttendanceDetail(
      page,
      { ...otherAdminAttendance, displayName: otherAdminDisplayName },
      otherAdminDisplayName,
    );
    await assertPayrollList(page, [
      { displayName: adminDisplayName },
      { displayName: otherAdminDisplayName },
    ]);

    await assertHistory(page, [{ attendanceDate: adminAttendanceDate }]);
    await otherAdmin.setSessionCookie(page.context());
    await assertHistory(page, [{ attendanceDate: otherAdminAttendanceDate }]);
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

test("staffをadminへ変更しても同じ利用者の過去勤怠と新規勤怠を表示できる", async ({
  page,
  admin,
}) => {
  const targetDisplayName = `E2Eロール変更対象-${randomUUID()}`;
  const target = await createAuthenticatedUser({
    displayName: targetDisplayName,
    role: "staff",
    status: "active",
  });
  const firstClockInAt = e2eTokyoDateAt(4, "09:00");
  const firstClockOutAt = e2eTokyoDateAt(4, "18:00");
  const secondClockInAt = e2eTokyoDateAt(5, "09:00");
  const secondClockOutAt = e2eTokyoDateAt(5, "18:00");
  const firstAttendanceDate = formatAttendanceDate(firstClockInAt);
  const secondAttendanceDate = formatAttendanceDate(secondClockInAt);
  const createdAttendanceIds: string[] = [];

  try {
    const executorDisplayName = await readDisplayName(target.db, admin.userId);
    const firstAttendance = await createAttendanceThroughForm({
      attendanceDate: firstAttendanceDate,
      clockInAt: firstClockInAt,
      clockOutAt: firstClockOutAt,
      displayName: targetDisplayName,
      page,
    });
    createdAttendanceIds.push(firstAttendance.attendanceId);
    await assertCompletedAttendanceDetail(
      page,
      { ...firstAttendance, displayName: targetDisplayName },
      executorDisplayName,
    );
    await assertAttendancePersisted(
      target.db,
      firstAttendance.attendanceId,
      admin.userId,
      { ...firstAttendance, userId: target.userId },
    );

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

    await page.goto("/admin/attendance/new");
    await page.getByLabel("作成対象者").click();
    await expect(
      page.getByRole("option", { name: targetDisplayName, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

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
    await assertCompletedAttendanceDetail(
      page,
      { ...secondAttendance, displayName: targetDisplayName },
      targetDisplayName,
    );
    await assertAttendancePersisted(
      target.db,
      secondAttendance.attendanceId,
      target.userId,
      { ...secondAttendance, userId: target.userId },
    );

    await expect
      .poll(async () => {
        const events = await target.db
          .select({
            attendanceId: attendanceEvents.attendanceId,
            eventType: attendanceEvents.eventType,
            payload: attendanceEvents.payload,
          })
          .from(attendanceEvents)
          .where(
            sql`${attendanceEvents.eventType} = 'AttendanceClockedIn' AND ${attendanceEvents.payload}->>'userId' = ${target.userId}`,
          );
        return events
          .filter((event) =>
            [
              firstAttendance.attendanceId,
              secondAttendance.attendanceId,
            ].includes(event.attendanceId),
          )
          .map((event) => ({
            attendanceId: event.attendanceId,
            userId: (event.payload as { userId?: unknown }).userId,
          }))
          .sort((left, right) =>
            left.attendanceId.localeCompare(right.attendanceId),
          );
      })
      .toEqual(
        [firstAttendance.attendanceId, secondAttendance.attendanceId]
          .sort()
          .map((attendanceId) => ({
            attendanceId,
            userId: target.userId,
          })),
      );

    const query = `from=${E2E_FROM}&to=${E2E_TO}&userId=${target.userId}`;
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
      await assertReadOnlyOtherAdminAttendanceDetail(
        page,
        { ...attendance, displayName: targetDisplayName },
        attendance.attendanceId === firstAttendance.attendanceId
          ? executorDisplayName
          : targetDisplayName,
      );
    }

    await assertPayrollList(page, [{ displayName: targetDisplayName }]);

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

test("勤怠一覧の時刻・状態列は勤務中、完了、取消済みで同じ位置に揃う", async ({
  page,
  admin,
}, testInfo) => {
  void admin;
  const attendanceDate = "2026-01-01";
  const rows = [
    {
      name: `E2E夜完了-${randomUUID()}`,
      workPeriod: "night" as const,
      clockInAt: e2eTokyoDateAt(0, "19:00"),
      clockOutAt: e2eTokyoDateAt(0, "22:00"),
    },
    {
      name: `E2E昼勤務中-${randomUUID()}`,
      workPeriod: "day" as const,
      clockInAt: e2eTokyoDateAt(0, "18:44"),
      clockOutAt: null,
    },
    {
      name: `E2E昼完了-${randomUUID()}`,
      workPeriod: "day" as const,
      clockInAt: e2eTokyoDateAt(0, "17:16"),
      clockOutAt: e2eTokyoDateAt(0, "18:30"),
    },
    {
      name: `E2E取消済み-${randomUUID()}`,
      workPeriod: "night" as const,
      clockInAt: e2eTokyoDateAt(0, "16:00"),
      clockOutAt: null,
      cancelled: true,
    },
  ];
  const staff = await Promise.all(
    rows.map(({ name }) =>
      createAuthenticatedUser({
        displayName: name,
        role: "staff",
        status: "active",
      }),
    ),
  );
  const attendanceIds: string[] = [];

  try {
    for (const [index, row] of rows.entries()) {
      const user = staff[index];
      if (!user) throw new Error("E2Eスタッフを取得できませんでした。");
      const attendanceId = randomUUID();
      attendanceIds.push(attendanceId);
      await user.db.transaction(async (tx) => {
        await tx.insert(attendanceEvents).values({
          attendanceId,
          performedByUserId: user.userId,
          eventVersion: 1,
          eventType: "AttendanceClockedIn",
          payload: {
            userId: user.userId,
            workPeriod: row.workPeriod,
            attendanceDate,
            clockInAt: row.clockInAt.toISOString(),
          },
        });
        if (row.clockOutAt) {
          await tx.insert(attendanceEvents).values({
            attendanceId,
            performedByUserId: user.userId,
            eventVersion: 2,
            eventType: "AttendanceClockedOut",
            payload: { clockOutAt: row.clockOutAt.toISOString() },
          });
        }
        if ("cancelled" in row && row.cancelled) {
          await tx.insert(attendanceEvents).values({
            attendanceId,
            performedByUserId: user.userId,
            eventVersion: 2,
            eventType: "AttendanceCancelled",
            payload: {},
          });
          await tx.insert(attendanceCurrentStates).values({
            attendanceId,
            userId: user.userId,
            attendanceDate,
            workPeriod: row.workPeriod,
            clockInAt: row.clockInAt,
            clockOutAt: row.clockOutAt,
            eventVersion: 2,
            isCancelled: true,
          });
        } else
          await tx.insert(attendanceCurrentStates).values({
            attendanceId,
            userId: user.userId,
            attendanceDate,
            workPeriod: row.workPeriod,
            clockInAt: row.clockInAt,
            clockOutAt: row.clockOutAt,
            eventVersion: row.clockOutAt ? 2 : 1,
          });
      });
    }

    for (const width of [390, 1365]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/admin/attendance?from=${attendanceDate}&to=${attendanceDate}`,
      );
      await page.reload();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const getPart = (rowName: string, part: string) =>
        getAttendanceLink(page, rowName, attendanceDate).locator(
          `[data-attendance-time-part="${part}"]`,
        );
      const getCell = (rowName: string) =>
        getAttendanceLink(page, rowName, attendanceDate).locator(
          "[data-attendance-time-cell]",
        );
      const cellBoxes = await Promise.all(
        rows.map(async (row) => {
          const cell = await getCell(row.name).boundingBox();
          const periodText = row.workPeriod === "day" ? "昼" : "夜";
          const period = await getAttendanceLink(page, row.name, attendanceDate)
            .getByText(periodText, { exact: true })
            .locator("xpath=..")
            .boundingBox();
          if (!cell || !period)
            throw new Error("勤怠セル寸法を取得できません。");
          return { cell, period };
        }),
      );
      const [nightCell, workingCell, dayCell, cancelledCell] = cellBoxes;
      if (!nightCell || !workingCell || !dayCell || !cancelledCell)
        throw new Error("勤怠行が不足しています。");
      for (const { cell, period } of cellBoxes) {
        expect(Math.abs(cell.x - nightCell.cell.x)).toBeLessThanOrEqual(0.75);
        expect(Math.abs(cell.width - nightCell.cell.width)).toBeLessThanOrEqual(
          0.75,
        );
        expect(
          Math.abs(
            period.x +
              period.width -
              nightCell.period.x -
              nightCell.period.width,
          ),
        ).toBeLessThanOrEqual(0.75);
      }
      const cancelledRow = rows.at(-1);
      if (!cancelledRow) throw new Error("取消済み勤怠 fixture がありません。");
      await expect(
        getAttendanceLink(page, cancelledRow.name, attendanceDate),
      ).toContainText("取消済み");
      const boxes = await Promise.all(
        rows.slice(0, 3).map(async (row) => {
          const clockIn = await getPart(row.name, "clock-in").boundingBox();
          const separator = await getPart(row.name, "separator").boundingBox();
          const clockOut = await getPart(row.name, "clock-out").boundingBox();
          if (!clockIn || !separator || !clockOut) {
            throw new Error("勤怠時刻列の寸法を取得できません。");
          }
          return { clockIn, separator, clockOut };
        }),
      );
      const [night, working, day] = boxes;
      if (!night || !working || !day)
        throw new Error("勤怠行が不足しています。");
      for (const box of boxes) {
        expect(
          Math.abs(
            box.clockIn.x +
              box.clockIn.width -
              night.clockIn.x -
              night.clockIn.width,
          ),
        ).toBeLessThanOrEqual(0.75);
        expect(
          Math.abs(
            box.separator.x +
              box.separator.width / 2 -
              (night.separator.x + night.separator.width / 2),
          ),
        ).toBeLessThanOrEqual(0.75);
      }
      expect(Math.abs(night.clockOut.x - day.clockOut.x)).toBeLessThanOrEqual(
        0.75,
      );
      expect(
        Math.abs(working.clockOut.x - night.clockOut.x),
      ).toBeLessThanOrEqual(0.75);

      for (const completed of [night, day]) {
        const leftGap =
          completed.separator.x -
          (completed.clockIn.x + completed.clockIn.width);
        const rightGap =
          completed.clockOut.x -
          (completed.separator.x + completed.separator.width);
        expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(0.75);
      }
      expect(working.clockOut.width).toBeCloseTo(night.clockOut.width, 2);
      await page.screenshot({
        path: testInfo.outputPath(
          width === 390 ? "attendance-smartphone.png" : "attendance-pc.png",
        ),
        fullPage: true,
      });
    }
  } finally {
    for (const record of staff) {
      try {
        await cleanupCreatedAttendances(record.db, attendanceIds, [
          record.userId,
        ]);
      } finally {
        await record.cleanup();
      }
    }
  }
});
