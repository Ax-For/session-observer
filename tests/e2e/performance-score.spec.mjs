import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("current score compares with a persisted model baseline that excludes today", async ({ page, request }, testInfo) => {
  const roots = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const suffix = testInfo.project.name, model = `score-model-${suffix}`, sessionId = `score-${suffix}`;
  const historyFile = path.join(roots.codex, `history-${suffix}.jsonl`), liveFile = path.join(roots.codex, `${sessionId}.jsonl`);
  const encode = (records) => records.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const make = (id, start, count, output) => {
    const stamp = (ms) => new Date(ms).toISOString();
    const records = [{ type: "session_meta", timestamp: stamp(start - 1000), payload: { id, title: `评分验收 ${suffix}` } }];
    for (let i = 0; i < count; i++) {
      const time = start + i * 10000;
      records.push({ type: "turn_context", timestamp: stamp(time), payload: { model } },
        { type: "event_msg", timestamp: stamp(time), payload: { type: "task_started" } },
        { type: "response_item", timestamp: stamp(time + 1000), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "fixture" }] } },
        { type: "token_usage_record", timestamp: stamp(time + 4000), payload: { response_id: `${id}-${i}`, usage: { input_tokens: 1000, cached_input_tokens: 950, reasoning_output_tokens: 80, output_tokens: output } } },
        { type: "event_msg", timestamp: stamp(time + 5000), payload: { type: "task_complete" } });
    }
    return records;
  };
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
    fs.writeFileSync(historyFile, encode(make(`history-${suffix}`, yesterday.getTime(), 20, 200)));
    fs.writeFileSync(liveFile, encode(make(sessionId, Date.now() - 50000, 3, 400)));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?tab=overview");
    const panel = page.getByTestId("performance-score-panel");
    await expect(panel.getByRole("combobox", { name: "评分会话" }).locator(`option[value="codex|${sessionId}"]`)).toHaveCount(1);
    await panel.getByRole("combobox", { name: "评分会话" }).selectOption(`codex|${sessionId}`);
    await panel.getByText("查看 7 项指标与历史基线").click();
    const refresh = panel.getByRole("button", { name: "更新基线" });
    await expect(refresh).toBeEnabled({ timeout: 15000 }); await refresh.click();
    await expect.poll(async () => {
      const value = await (await request.get("/api/performance-baseline")).json();
      return value.status === "ready" && value.models.find((r) => r.model === model)?.n;
    }, { timeout: 15000 }).toBe(20);
    await expect(panel.getByTestId("performance-baseline")).not.toHaveText("—");
    await expect(panel.getByTestId("performance-current")).not.toHaveText("—");
    await expect(panel.getByTestId("performance-comparison")).toContainText("+");
    await expect(panel.getByText("3 次有效响应 · 暂定评分")).toBeVisible();
    await expect(panel.getByRole("table").getByRole("row")).toHaveCount(8);
    await expect(panel.locator(".data-chart__plot svg")).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath("performance-light.png") });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await panel.screenshot({ path: testInfo.outputPath("performance-dark.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { fs.rmSync(historyFile, { force: true }); fs.rmSync(liveFile, { force: true }); }
});
