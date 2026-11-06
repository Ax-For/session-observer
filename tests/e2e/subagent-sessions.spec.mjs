import { test, expect } from "@playwright/test";

test("subagents are hidden by default but remain searchable and navigable", async ({ page, request }, testInfo) => {
  const childId = "aaaaaaaa-1111-4111-8111-111111111111";
  const response = await request.get("/api/sessions");
  const sessions = Object.values((await response.json()).groups).flat();
  const child = sessions.find((session) => session.sessionId === childId);
  expect(child.parentSessionId).toBe("demo-session");
  expect(child.count).toBe(4);
  expect(child.isSubagent).toBe(true);
  expect(sessions.find((session) => session.sessionId === "demo-session").sourceFiles).not.toContain(child.sourceFiles[0]);
  const events = await (await request.get(`/api/events?sessionId=${childId}&summary=0&mode=raw`)).json();
  expect(events.events).toHaveLength(4);
  expect(events.events.every((event) => event.sessionId === childId)).toBe(true);
  const detail = await (await request.get(`/api/events/detail?eventId=${encodeURIComponent(events.events[0].eventId)}`)).json();
  expect(detail.event.sessionId).toBe(childId);

  await page.goto("/?tab=sessions");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".command-deck__summary")).toHaveText("1 会话");
  await expect(page.locator(".session-row")).toContainText("2 个子 Agent");
  await page.locator(".session-row__main").first().click();
  await page.locator(".session-relations summary").click();
  await expect(page.locator(".session-relations__list button")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("main-session-family.png") });
  await page.locator(".session-relations__list button").filter({ hasText: "检索子 Agent" }).click();
  await expect(page).toHaveURL(new RegExp(`session=${childId}`));
  await expect(page.getByRole("button", { name: /返回父会话/ })).toBeVisible();
  expect(await page.locator(".session-query-actions .mantine-Button-label").evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("child-detail.png") });
  await page.getByRole("button", { name: /返回父会话/ }).click();
  await expect(page).toHaveURL(/session=demo-session/);

  await page.locator(".session-scope-toolbar label").filter({ hasText: /^全部$/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(3);
  await page.locator(".session-scope-toolbar label").filter({ hasText: /^子 Agent$/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await expect(page).toHaveURL(/agents=children/);
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("child-library.png") });

  await page.goto("/?tab=stream");
  await expect(page.locator(".session-rail__item")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索", exact: true }).fill("子任务唯一关键词");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const hit = page.locator(".event-row__open").filter({ hasText: "子任务唯一关键词" });
  await expect(hit).toBeVisible();
  await expect(page.locator(".session-rail__item")).toHaveCount(1);
  await expect(page.locator(".session-rail__metrics")).toContainText("子 Agent");
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`session=${childId}`));
  await expect(page.getByRole("button", { name: /返回父会话/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回搜索结果" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("child-search-context.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
