import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("Qwen Code log appends reach live speed, session replay, search and retained usage", async ({ page, request }, testInfo) => {
  const { qwen } = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const sessionId = `qwen-${testInfo.project.name}`;
  const cwd = "/fixture/qwen-demo";
  const chats = path.join(qwen, sessionId, "chats");
  const file = path.join(chats, `${sessionId}.jsonl`);
  const model = `qwen-model-${testInfo.project.name}`;
  const prompt = "核对 Qwen 本地会话";
  const answer = "Qwen独立检索样例";
  const record = (timestamp, type, suffix, fields = {}) => ({
    timestamp: new Date(timestamp).toISOString(), type, sessionId, cwd, uuid: `${sessionId}-${suffix}`, ...fields,
  });
  const append = (...rows) => fs.appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  fs.mkdirSync(chats, { recursive: true });
  try {
    const theme = testInfo.project.name === "desktop-1440" ? "dark" : "light";
    await page.addInitScript((value) => localStorage.setItem("observer-theme-mode", JSON.stringify(value)), theme);
    await page.goto("/?tab=overview");
    const panel = page.getByTestId("live-speed-panel");
    await expect(panel.getByRole("status")).toHaveText("实时连接");
    append(record(Date.now(), "user", "prompt", { message: { role: "user", parts: [{ text: prompt }] } }));
    const session = panel.getByRole("button", { name: `查看会话 ${sessionId}`, exact: true });
    await expect(session).toContainText("生成中");
    const completed = Date.now();
    append(
      record(completed - 1, "system", "telemetry", { subtype: "ui_telemetry", systemPayload: { uiEvent: {
        "event.name": "qwen-code.api_response", status_code: 200, duration_ms: 1800,
      } } }),
      record(completed, "assistant", "answer", {
        parentUuid: `${sessionId}-telemetry`, model, message: { role: "model", parts: [{ text: `${"正文。".repeat(1600)}${answer}` }] },
        usageMetadata: { promptTokenCount: 240, cachedContentTokenCount: 100, candidatesTokenCount: 60, thoughtsTokenCount: 12, totalTokenCount: 300 },
      }),
    );
    await expect.poll(async () => {
      const snapshot = await (await request.get("/api/live-speed/snapshot")).json();
      const source = snapshot.sources.find((row) => row.sourceType === "qwen");
      return source.measured > 0 && source.rates.total.measured > source.measured && source.rates.reasoning.measured > 0;
    }).toBe(true);
    await expect(panel.locator("dl").getByText("Qwen Code", { exact: true })).toBeVisible();
    await panel.getByLabel("显示空闲").check();
    await expect(session).toContainText("空闲");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath("qwen-live.png") });
    await session.click();
    const usageTab = page.getByRole("tab", { name: "用量", exact: true });
    await usageTab.click();
    const performance = page.getByRole("region", { name: "响应性能" });
    await expect(performance).toContainText("1 / 1");
    await performance.getByText("响应明细", { exact: true }).click();
    await expect(performance.getByRole("row").filter({ hasText: model })).toContainText("1.80 s");

    await page.goto("/?tab=sessions&sg=platform&sp=qwen");
    const group = page.locator('[data-session-section-key="qwen"]');
    await expect(group.getByRole("heading", { name: "Qwen Code", exact: true })).toBeVisible();
    await expect(group.locator(".session-row__main")).toContainText(prompt);
    await group.screenshot({ path: testInfo.outputPath("qwen-platform-group.png") });

    await page.goto("/?tab=tokens");
    const qwenUsage = page.getByRole("list", { name: "各平台 Token 占比" }).getByRole("listitem").filter({ hasText: "Qwen Code" });
    await expect(qwenUsage.getByTitle("300 Token", { exact: true })).toBeVisible();
    const trend = page.getByTestId("token-trend-chart");
    await trend.getByRole("button", { name: "查看数据明细" }).click();
    await expect(trend.getByRole("columnheader", { name: "Qwen Code", exact: true })).toBeVisible();
    const qwenColumn = await trend.getByRole("columnheader", { name: "Qwen Code", exact: true }).evaluate((cell) => cell.cellIndex);
    await expect(trend.locator(`tbody tr td:nth-child(${qwenColumn + 1})`).filter({ hasText: /^300$/ })).toBeVisible();
    await page.locator(".v2-token-primary").screenshot({ path: testInfo.outputPath("qwen-token-breakdown.png") });

    await page.goto("/?tab=stream&platform=qwen");
    await expect(page.locator(".feed-panel__scope")).toHaveText("Qwen Code · 全部事件 · 观测事件");
    const platformCounts = page.getByLabel("各平台匹配会话");
    await expect(platformCounts.locator("div").filter({ hasText: "Qwen Code" }).locator("dd")).toHaveText("1");
    await expect(platformCounts.locator("div").filter({ hasText: "Codex" }).locator("dd")).toHaveText("0");
    await expect(platformCounts.locator("div").filter({ hasText: "Claude Code" }).locator("dd")).toHaveText("0");
    await expect(page.locator(".session-rail__item")).toHaveCount(1);
    await page.getByRole("region", { name: "当前窗口分析" }).screenshot({ path: testInfo.outputPath("qwen-stream-platforms.png") });
    await page.getByRole("textbox", { name: "搜索", exact: true }).fill(answer);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const hit = page.locator(".event-row__open").filter({ hasText: answer }).first();
    await expect(hit.locator("mark")).toHaveText(answer);

    const refresh = await request.post("/api/usage-history/refresh", { headers: { "X-Observer-Request": "1" } });
    expect(refresh.status()).toBe(202);
    await expect.poll(async () => {
      const result = await (await request.get(`/api/usage-history?source=qwen&model=${model}`)).json();
      const totals = result.totals;
      return totals && [totals.requests, totals.input, totals.cachedInput, totals.output, totals.reasoning];
    }, { timeout: 15_000 }).toEqual([1, 240, 100, 60, 12]);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
