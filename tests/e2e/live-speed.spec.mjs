import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("live log appends update platform speeds, phases, history and session navigation", async ({ page, request }, testInfo) => {
  const roots = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const codexId = `live-speed-${testInfo.project.name}`;
  const claudeId = `live-claude-${testInfo.project.name}`;
  const title = `实时测速演示 ${testInfo.project.name}`;
  const codexFile = path.join(roots.codex, `${codexId}.jsonl`);
  const claudeFile = path.join(roots.claude, `${claudeId}.jsonl`);
  const stamp = (offset = 0) => new Date(Date.now() + offset).toISOString();
  const append = (file, row) => fs.appendFileSync(file, JSON.stringify(row) + "\n");
  try {
    fs.writeFileSync(codexFile, ""); fs.writeFileSync(claudeFile, "");
    append(codexFile, { type: "session_meta", timestamp: stamp(-20000), payload: { id: codexId, title, cwd: "/fixture/live-codex" } });
    append(codexFile, { type: "event_msg", timestamp: stamp(-12000), payload: { type: "task_started" } });
    append(codexFile, { type: "token_usage_record", timestamp: stamp(-8000), payload: { response_id: "ref", usage: { output_tokens: 200 } } });
    append(claudeFile, { type: "user", timestamp: stamp(-12000), sessionId: claudeId, cwd: "/fixture/live-claude", message: { content: "fixture" } });
    append(claudeFile, { type: "assistant", timestamp: stamp(-8000), sessionId: claudeId, message: { id: "ref", model: "claude-test", stop_reason: "end_turn", usage: { output_tokens: 120 }, content: [{ type: "text", text: "fixture" }] } });
    append(codexFile, { type: "event_msg", timestamp: stamp(), payload: { type: "task_started" } });
    append(claudeFile, { type: "api-request", timestamp: stamp(), sessionId: claudeId });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?tab=overview");
    const panel = page.getByTestId("live-speed-panel");
    await expect(panel.getByRole("status")).toHaveText("实时连接");
    const codexRow = panel.getByRole("button", { name: `查看会话 ${title}` });
    const claudeRow = panel.getByRole("button", { name: `查看会话 ${claudeId}` });
    await expect(codexRow).toContainText("生成中");
    await expect(claudeRow).toContainText("生成中");
    await expect.poll(async () => {
      const s = await (await request.get("/api/live-speed/snapshot")).json();
      return s.sources.every((source) => source.estimated > 0);
    }).toBe(true);
    await expect(panel.locator(".live-speed__throughput .data-chart__plot svg")).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath("live-speed-light.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    append(codexFile, { type: "token_usage_record", timestamp: stamp(), payload: { response_id: "live", usage: { output_tokens: 300 } } });
    append(claudeFile, { type: "assistant", timestamp: stamp(), sessionId: claudeId, message: { id: "live", model: "claude-test", stop_reason: "tool_use", usage: { output_tokens: 200 }, content: [{ type: "tool_use", id: "tool", name: "Read", input: {} }] } });
    await expect(codexRow).toContainText("工具执行");
    await expect(claudeRow).toContainText("工具执行");
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await panel.screenshot({ path: testInfo.outputPath("live-speed-dark.png") });
    append(codexFile, { type: "event_msg", timestamp: stamp(), payload: { type: "task_complete" } });
    append(claudeFile, { type: "user", timestamp: stamp(), sessionId: claudeId, toolEndsTurn: true, message: { content: [] } });
    await expect(codexRow).not.toBeVisible();
    await panel.getByLabel("显示空闲").check();
    await expect(codexRow).toContainText("空闲");
    await expect(claudeRow).toContainText("空闲");
    await codexRow.click();
    await expect(page.getByRole("tab", { name: "用量", exact: true })).toBeVisible();
  } finally {
    fs.rmSync(codexFile, { force: true }); fs.rmSync(claudeFile, { force: true });
  }
});
