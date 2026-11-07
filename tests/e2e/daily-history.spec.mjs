import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";

test("daily history includes archived and extra-root usage, exports the selected range and keeps deleted-log totals", async ({ page, request }, testInfo) => {
  const roots = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const tag = testInfo.project.name, model = `daily-history-${tag}`;
  const archive = path.join(roots.archive, `${tag}.jsonl.zst`), active = path.join(roots.extraClaude, `${tag}.jsonl`);
  const day = new Date(); day.setDate(day.getDate() - 63); day.setHours(12, 0, 0, 0);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const encode = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const archiveRows = [{ type: "session_meta", timestamp: new Date(day - 1000).toISOString(), payload: { id: `archive-${tag}` } }];
  for (let i = 0; i < 20; i++) {
    const time = day.getTime() + i * 10_000;
    archiveRows.push({ type: "turn_context", timestamp: new Date(time).toISOString(), payload: { model, service_tier: "priority", effort: "high" } },
      { type: "event_msg", timestamp: new Date(time).toISOString(), payload: { type: "task_started" } },
      { type: "response_item", timestamp: new Date(time + 1000).toISOString(), payload: { type: "message", role: "assistant", content: "PRIVATE-E2E-TRANSCRIPT" } },
      { type: "token_usage_record", timestamp: new Date(time + 4000).toISOString(), payload: { response_id: `${model}-${i}`, usage: { input_tokens: 100, output_tokens: 200 } } });
  }
  fs.writeFileSync(archive, zstdCompressSync(Buffer.from(encode(archiveRows))));
  const started = Date.now() - 20_000, sessionId = `extra-claude-${tag}`;
  fs.writeFileSync(active, encode([
    { type: "user", timestamp: new Date(started).toISOString(), sessionId, message: { content: "PRIVATE-E2E-PROMPT" } },
    { type: "assistant", timestamp: new Date(started + 4000).toISOString(), sessionId, perTurnEffort: "high",
      message: { id: sessionId, model: "claude-sonnet-4-5", stop_reason: "end_turn", content: "PRIVATE-E2E-ANSWER", usage: { input_tokens: 60, output_tokens: 160, speed: "fast" } } },
  ]));
  try {
    await page.goto("/?tab=tokens");
    await page.getByRole("radiogroup", { name: "Token 账本视图" }).getByText("每日历史", { exact: true }).click();
    const panel = page.getByRole("region", { name: "每日使用历史" });
    const update = panel.getByRole("button", { name: "更新历史", exact: true });
    await expect(update).toBeEnabled({ timeout: 15000 });
    await update.click();
    await expect.poll(async () => {
      const result = await (await request.get(`/api/usage-history?from=${date}&to=${date}&source=codex&model=${model}`)).json();
      return result.totals?.requests;
    }, { timeout: 15000 }).toBe(20);
    await panel.getByLabel("开始日期", { exact: true }).fill(date);
    await panel.getByLabel("结束日期", { exact: true }).fill(date);
    await panel.getByRole("combobox", { name: "来源", exact: true }).selectOption("codex");
    await panel.getByRole("button", { name: "应用筛选" }).click();
    const modelSelect = panel.getByRole("combobox", { name: "模型", exact: true });
    await expect(modelSelect.locator(`option[value="${model}"]`)).toHaveCount(1);
    await modelSelect.selectOption(model);
    await panel.getByRole("button", { name: "应用筛选" }).click();
    const row = panel.getByRole("row").filter({ hasText: date });
    await expect(row).toContainText("4,000");
    await expect(row).toContainText("50.0");
    await expect(row.getByTestId("history-day-score")).not.toHaveText("—");
    await expect(panel.locator(".data-chart__plot svg")).toBeVisible();
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "导出 CSV", exact: true }).click();
    const csv = fs.readFileSync(await (await download).path(), "utf8");
    expect(csv).toContain(`${date},codex,${model},20,2000,0,0,4000`);
    expect(csv).not.toContain("PRIVATE-E2E");
    await panel.getByText("执行档位与推理强度", { exact: true }).click();
    await expect(panel.getByRole("row").filter({ hasText: "已选择" })).toContainText("Fast");

    fs.rmSync(archive);
    const previous = (await (await request.get("/api/usage-history/status")).json()).generatedAt;
    await update.click();
    await expect.poll(async () => (await (await request.get("/api/usage-history/status")).json()).generatedAt).toBeGreaterThan(previous);
    await expect(row).toContainText("4,000");
    await panel.screenshot({ path: testInfo.outputPath("daily-history-light.png") });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await panel.screenshot({ path: testInfo.outputPath("daily-history-dark.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/?tab=overview");
    const speed = page.getByTestId("live-speed-panel");
    await speed.getByLabel("显示空闲").check();
    await expect(speed.getByRole("button", { name: `查看会话 ${sessionId}`, exact: true })).toContainText("Fast");
    await expect(speed.getByRole("button", { name: `查看会话 ${sessionId}`, exact: true })).toContainText("High");
    const forbidden = await request.get(`/api/usage-history?format=csv&from=${date}&to=${date}`, { headers: { "sec-fetch-site": "cross-site" } });
    expect(forbidden.status()).toBe(403);
  } finally { fs.rmSync(archive, { force: true }); fs.rmSync(active, { force: true }); }
});
