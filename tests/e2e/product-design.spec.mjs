import { test, expect } from "@playwright/test";

test("product workspace keeps primary content readable across all desktop views", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("observer-theme-mode", JSON.stringify("light")));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?tab=overview");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  for (const [name, view] of [["总览", "overview"], ["Token", "tokens"], ["事件流", "stream"], ["会话", "sessions"]]) {
    await page.getByRole("navigation", { name: "主导航" }).getByRole("radio", { name, exact: true }).click();
    await expect(page.locator("[data-workbench-view]")).toHaveAttribute("data-workbench-view", view);
    await expect(page.getByRole("heading", { name: { overview: "运行总览", tokens: "用量分析", stream: "事件检索", sessions: "会话管理" }[view], exact: true })).toBeVisible();
    if (view === "overview") await expect(page.getByTestId("overview-activity-chart").locator(".data-chart__plot svg")).toBeVisible();
    if (view === "tokens") await expect(page.getByTestId("token-trend-chart").locator(".data-chart__plot svg")).toBeVisible();
    if (view === "sessions") await expect(page.locator(".session-row").first()).toBeVisible();
    if (view === "stream") {
      await expect(page.locator(".session-rail__item").first()).toBeVisible();
      expect(await page.locator(".session-rail__title-row").first().evaluate((node) => {
        const title = node.querySelector("strong").getBoundingClientRect();
        const time = node.querySelector("time").getBoundingClientRect();
        return title.bottom <= time.top;
      })).toBe(true);
    }
    await expect(page.getByTestId("workspace-canvas").locator("[aria-busy=true]")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${view}-light.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator(".session-row__main").first().click();
  await expect(page.locator(".session-chat-turn").first()).toBeVisible();
  expect(await page.locator(".session-chat-scroll").evaluate((node) => node.clientHeight)).toBeGreaterThan(300);
  expect(await page.locator(".session-chat-turn__body .conv-message-plain, .session-chat-turn__body .conv-markdown").first().evaluate((node) => getComputedStyle(node).fontSize)).toBe("14px");
  await page.screenshot({ path: testInfo.outputPath("conversation-light.png"), animations: "disabled" });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-observer-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("sessions-dark.png"), animations: "disabled" });
  for (const [name, view] of [["总览", "overview"], ["Token", "tokens"], ["事件流", "stream"]]) {
    await page.getByRole("navigation", { name: "主导航" }).getByRole("radio", { name, exact: true }).click();
    await expect(page.getByTestId("workspace-canvas").locator("[aria-busy=true]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${view}-dark.png`), animations: "disabled" });
  }
  expect(errors).toEqual([]);
});

test("initial statistics failure offers a retry instead of showing false zero totals", async ({ page }) => {
  await page.route("**/api/observability", (route) => route.fulfill({ status: 503, json: { error: "演示服务暂不可用" } }));
  await page.goto("/?tab=overview");
  await expect(page.getByRole("heading", { name: "统计暂不可用" })).toBeVisible();
  await expect(page.getByLabel("当前运行摘要")).toHaveCount(0);
  await page.unroute("**/api/observability");
  await page.getByRole("button", { name: "重新加载统计" }).click();
  await expect(page.getByLabel("当前运行摘要")).toBeVisible();
});
