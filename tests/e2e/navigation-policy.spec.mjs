import { test, expect } from "@playwright/test";
import http from "node:http";

test("an external link opens the local app while cross-site API navigation stays blocked", async ({ page }) => {
  const target = "http://127.0.0.1:8878";
  const external = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<a href="${target}/?tab=overview">打开本地总览</a><a href="${target}/api/live-speed/snapshot">读取会话数据</a>`);
  });
  await new Promise((resolve) => external.listen(0, "127.0.0.1", resolve));
  const origin = `http://localhost:${external.address().port}`;
  try {
    await page.goto(origin);
    const navigation = page.waitForRequest((request) => request.isNavigationRequest() && request.url().startsWith(target));
    await page.getByRole("link", { name: "打开本地总览" }).click();
    const headers = await (await navigation).allHeaders();
    expect(headers["sec-fetch-site"]).toBe("cross-site");
    expect(headers["sec-fetch-mode"]).toBe("navigate");
    expect(headers["sec-fetch-dest"]).toBe("document");
    await expect(page.getByTestId("live-speed-panel")).toBeVisible();
    await expect(page.getByTestId("live-speed-panel").getByRole("status")).toHaveText("实时连接");
    await page.goto(origin);
    const denied = page.waitForResponse((response) => response.url() === `${target}/api/live-speed/snapshot`);
    await page.getByRole("link", { name: "读取会话数据" }).click();
    expect((await denied).status()).toBe(403);
    await expect(page.locator("body")).toContainText("Cross-site requests are not allowed");
  } finally {
    external.close();
    external.closeAllConnections();
  }
});
