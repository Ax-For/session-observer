import { test, expect } from "@playwright/test";

test("quota refresh shows progress, cached failures, retry success and persisted freshness", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let snapshot = {
    status: "ready", installed: true, version: "codex-cli test", planType: "pro",
    updatedAt: "2026-09-12T02:00:00Z", defaultLimitId: "codex", resetCredits: null,
    limits: [{ id: "codex", name: "Codex", primary: {
      usedPercent: 35, remainingPercent: 65, windowDurationMinutes: 300,
      resetsAt: "2026-09-12T09:00:00Z",
    }, secondary: null }], error: "",
  };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let queries = 0;
  await page.route("**/api/codex-usage", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/codex-usage/refresh", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-observer-request"]).toBe("1");
    queries += 1;
    if (queries === 1) {
      await gate;
      await route.fulfill({ json: { ...snapshot, error: "未找到 Codex 可执行文件；当前显示上次结果" } });
    } else {
      snapshot = { ...snapshot, updatedAt: "2026-09-12T03:00:00Z", limits: [{ ...snapshot.limits[0], primary: {
        ...snapshot.limits[0].primary, usedPercent: 40, remainingPercent: 60,
      } }] };
      await route.fulfill({ json: snapshot });
    }
  });
  await page.goto("/?tab=overview");
  const band = page.locator('[aria-label="Codex 使用额度"]');
  await expect(band.getByText("剩余 65%", { exact: true })).toBeVisible();
  await expect(band.getByRole("progressbar", { name: "5 小时额度剩余额度" })).toHaveAttribute("aria-valuenow", "65");
  expect(queries).toBe(0);
  const previousTime = await band.locator(".v5-codex-usage__action-meta").innerText();
  await band.getByRole("button", { name: "重新查询 Codex 使用额度" }).click();
  await expect(band).toHaveAttribute("aria-busy", "true");
  await expect(band.getByText("剩余 65%", { exact: true })).toBeVisible();
  await expect(band.getByRole("button")).toBeDisabled();
  await expect(band.getByRole("status", { name: "额度查询状态" })).toHaveText("查询中");
  const refreshGlyph = band.getByRole("button").locator(".interface-motion-icon");
  await expect(refreshGlyph).toHaveAttribute("data-motion", "rotating");
  const firstTransform = await refreshGlyph.evaluate((node) => getComputedStyle(node).transform);
  await expect.poll(() => refreshGlyph.evaluate((node) => getComputedStyle(node).transform)).not.toBe(firstTransform);
  await band.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await band.screenshot({ path: testInfo.outputPath("quota-querying.png") });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(refreshGlyph).toHaveAttribute("data-motion", "still");
  await expect(refreshGlyph).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(refreshGlyph).toHaveAttribute("data-motion", "rotating");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(refreshGlyph).toHaveAttribute("data-motion", "still");
  await expect(refreshGlyph).toHaveCSS("transform", "none");
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(refreshGlyph).toHaveAttribute("data-motion", "rotating");
  release();
  await expect(band.getByRole("alert", { name: "Codex 额度查询失败" })).toBeVisible();
  await expect(band.getByRole("status", { name: "额度查询状态" })).toHaveText("上次结果");
  await expect(band.locator(".v5-codex-usage__action-meta")).toHaveText(previousTime);
  await band.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await band.screenshot({ path: testInfo.outputPath("quota-retry.png") });
  await band.getByRole("button", { name: "重新查询 Codex 使用额度" }).click();
  await expect(band.getByText("剩余 60%", { exact: true })).toBeVisible();
  await expect(band.getByRole("alert")).toHaveCount(0);
  await expect(band.getByRole("status", { name: "额度查询状态" })).toHaveText("已缓存");
  await expect(refreshGlyph).toHaveAttribute("data-motion", "still");
  await expect(band.locator(".v5-codex-usage__action-meta")).not.toHaveText(previousTime);
  await page.reload();
  await expect(band.getByText("剩余 60%", { exact: true })).toBeVisible();
  expect(queries).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("first-time quota query shows skeletons without zero-valued quota bars", async ({ page }, testInfo) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/codex-usage", (route) => route.fulfill({ json: {
    status: "idle", installed: true, version: "codex-cli test", limits: [],
  } }));
  await page.route("**/api/codex-usage/refresh", async (route) => {
    await gate;
    await route.fulfill({ json: { status: "unavailable", installed: true, error: "连接超时，请重新查询", limits: [] } });
  });
  await page.goto("/?tab=overview");
  const band = page.getByLabel("Codex 使用额度", { exact: true });
  await band.getByRole("button", { name: "查询 Codex 使用额度" }).click();
  await expect(band.locator(".mantine-Skeleton-root")).toHaveCount(2);
  await expect(band.getByRole("progressbar")).toHaveCount(0);
  await expect(band.getByRole("button")).toBeDisabled();
  await band.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await band.screenshot({ path: testInfo.outputPath("quota-first-query.png") });
  release();
  await expect(band.getByText("账户额度读取失败")).toBeVisible();
  await expect(band.getByRole("status", { name: "额度查询状态" })).toHaveText("查询失败");
  await expect(band.getByRole("button")).toBeEnabled();
  await expect(band.locator(".mantine-Skeleton-root")).toHaveCount(0);
});
