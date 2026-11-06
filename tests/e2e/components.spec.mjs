import { test, expect } from "@playwright/test";

test("animated navigation changes SVG paths on hover and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?tab=overview");
  const target = page.getByRole("navigation", { name: "主导航" }).getByRole("radio", { name: "Token", exact: true });
  const symbol = target.locator("[data-animated-symbol] svg");
  await expect(symbol).toBeVisible();
  const before = await symbol.innerHTML();
  await target.hover();
  await expect.poll(() => symbol.innerHTML()).not.toBe(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(900, 10);
  await page.waitForTimeout(100);
  const still = await symbol.innerHTML();
  await target.hover();
  await page.waitForTimeout(150);
  expect(await symbol.innerHTML()).toBe(still);
  await target.click();
  await expect(page.getByTestId("token-trend-chart").locator(".data-chart__plot svg")).toBeVisible();
});

test("chart values, metric switches and theme changes remain usable", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?tab=tokens");
  const trend = page.getByTestId("token-trend-chart");
  await expect(trend.locator(".data-chart__plot svg")).toBeVisible();
  await trend.getByRole("button", { name: "查看数据明细" }).click();
  await expect(trend.getByRole("columnheader", { name: "Codex", exact: true })).toBeVisible();
  await expect(trend.getByRole("cell", { name: "50,400", exact: true }).first()).toBeVisible();
  await trend.getByRole("button", { name: "返回图表" }).click();
  await page.getByText("金额", { exact: true }).click();
  await trend.getByRole("button", { name: "查看数据明细" }).click();
  await expect(trend.getByRole("columnheader", { name: "成本估算 (USD)", exact: true })).toBeVisible();
  await trend.getByRole("button", { name: "返回图表" }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(trend.locator(".data-chart__plot svg")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("token-charts-theme.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
