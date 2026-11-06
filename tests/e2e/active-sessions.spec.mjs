import { test, expect } from "@playwright/test";

test("active counts roll child agents into main sessions on both pages", async ({ page }, testInfo) => {
  const latest = new Date().toISOString();
  const session = (sessionId, sessionTitle, parentSessionId = "") => ({
    sessionId, sessionTitle, displayTitle: sessionTitle, parentSessionId, latest,
    startedAt: latest, sourceType: "codex", cwd: "/demo/workspace", count: 10,
    models: [], sourceFiles: [], aggregateToken: { total: 100 },
  });
  const groups = { "/demo/workspace": [
    session("demo-session", "演示工作会话"),
    session("reader", "阅读器主会话", "reader"),
    session("helper-1", "代码检查子 Agent", "reader"),
    session("helper-2", "测试子 Agent", "reader"),
  ] };
  await page.route("**/api/sessions", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), total: 4, groups } });
  });
  await page.route("**/api/observability", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.summary.sessions.byCwd = groups;
    await route.fulfill({ response, json: data });
  });

  await page.goto("/?tab=sessions");
  await expect(page.locator(".active-sessions-panel__summary strong")).toHaveText("2");
  await expect(page.locator(".active-session-row")).toHaveCount(2);
  await expect(page.locator(".active-sessions-panel").getByText("含 2 个活跃子 Agent", { exact: true })).toBeVisible();
  expect(await page.locator(".active-session-row__children").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator(".active-sessions-panel")).not.toContainText("代码检查子 Agent");
  await page.screenshot({ path: testInfo.outputPath("active-main-sessions.png") });

  await page.getByRole("radio", { name: "总览", exact: true }).click();
  await expect(page.locator(".v2-overview-live .mc-active-row")).toHaveCount(2);
  await expect(page.locator(".v2-overview-live")).toContainText("2 活跃");
  await expect(page.locator(".v2-overview-live").getByText("含 2 个活跃子 Agent", { exact: true })).toBeVisible();
  await expect(page.locator(".v2-overview-live")).not.toContainText("代码检查子 Agent");
  await page.locator(".v2-overview-live").screenshot({ path: testInfo.outputPath("overview-main-sessions.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
