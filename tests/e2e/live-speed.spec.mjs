import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("live log appends update platform speeds, phases, history and session navigation", async ({ page, request }, testInfo) => {
  const roots = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const codexId = `live-speed-${testInfo.project.name}`;
  const claudeId = `live-claude-${testInfo.project.name}`;
  const model = `live-price-${testInfo.project.name}`;
  const title = `实时测速演示 ${testInfo.project.name}`;
  const codexFile = path.join(roots.codex, `${codexId}.jsonl`);
  const claudeFile = path.join(roots.claude, `${claudeId}.jsonl`);
  const stamp = (offset = 0) => new Date(Date.now() + offset).toISOString();
  const append = (file, row) => fs.appendFileSync(file, JSON.stringify(row) + "\n");
  const { rates } = await (await request.get("/api/pricebook")).json();
  const savePrices = (next) => request.put("/api/pricebook", { headers: { "X-Observer-Request": "1" }, data: { rates: next } });
  let savedPrice = false;
  try {
    fs.writeFileSync(codexFile, ""); fs.writeFileSync(claudeFile, "");
    append(codexFile, { type: "session_meta", timestamp: stamp(-20000), payload: { id: codexId, title, cwd: "/fixture/live-codex" } });
    append(codexFile, { type: "turn_context", timestamp: stamp(-13000), payload: { model } });
    append(codexFile, { type: "event_msg", timestamp: stamp(-12000), payload: { type: "task_started" } });
    append(codexFile, { type: "token_usage_record", timestamp: stamp(-8000), payload: { response_id: `${codexId}-ref`, usage: {
      input_tokens: 400, cached_input_tokens: 100, output_tokens: 200, reasoning_output_tokens: 60 } } });
    append(claudeFile, { type: "user", timestamp: stamp(-12000), sessionId: claudeId, cwd: "/fixture/live-claude", message: { content: "fixture" } });
    append(claudeFile, { type: "assistant", timestamp: stamp(-8000), sessionId: claudeId, costUSD: 0.012,
      message: { id: `${claudeId}-ref`, model: "claude-test", stop_reason: "end_turn", usage: {
        input_tokens: 70, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 120,
        output_tokens_details: { thinking_tokens: 30 },
      }, content: [{ type: "text", text: "fixture" }] } });
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
      return ["codex", "claude"].every((key) => {
        const source = s.sources.find((entry) => entry.sourceType === key);
        return source.estimated > 0 && source.rates.total.estimated > source.estimated && source.rates.reasoning.estimated > 0;
      });
    }).toBe(true);
    await expect(panel.getByTestId("live-speed-cost")).not.toHaveText("—");
    await expect(panel.getByText(/^已计价 \d+% 输出$/)).toBeVisible();
    const saved = await savePrices([...rates, { model, input: 10, output: 40, cacheRead: 1, cacheCreation: 10 }]);
    savedPrice = saved.ok();
    expect(savedPrice).toBe(true);
    await expect.poll(async () => {
      const s = await (await request.get("/api/live-speed/snapshot")).json();
      return s.sources.find((source) => source.sourceType === "codex").rates.cost.estimated;
    }).toBeGreaterThan(0);
    const readouts = panel.getByRole("radiogroup", { name: "实时指标" });
    for (const label of ["总吞吐", "推理速度", "每秒费用"]) {
      await readouts.getByText(label, { exact: true }).click();
      await expect(panel.getByRole("img", { name: `近 5 分钟${label}趋势` })).toBeVisible();
    }
    await expect(panel.locator(".live-speed__throughput .data-chart__plot svg")).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath("live-speed-light.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    append(codexFile, { type: "token_usage_record", timestamp: stamp(), payload: { response_id: `${codexId}-live`, usage: { output_tokens: 300 } } });
    append(claudeFile, { type: "assistant", timestamp: stamp(), sessionId: claudeId, message: { id: `${claudeId}-live`, model: "claude-test", stop_reason: "tool_use", usage: { output_tokens: 200 }, content: [{ type: "tool_use", id: "tool", name: "Read", input: {} }] } });
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
    if (savedPrice) await savePrices(rates);
  }
});

test("the live trend range can be switched and is restored after reload", async ({ page, request }, testInfo) => {
  const theme = testInfo.project.name === "desktop-1440" ? "dark" : "light";
  await page.addInitScript((value) => localStorage.setItem("observer-theme-mode", JSON.stringify(value)), theme);
  await page.goto("/?tab=overview");
  const panel = page.getByTestId("live-speed-panel");
  const range = panel.getByRole("combobox", { name: "趋势时间范围" });
  await expect(range).toHaveValue("5");
  await expect(panel.getByText("每点 1 秒", { exact: true })).toBeVisible();
  for (const [minutes, seconds] of [[1, 1], [15, 3], [30, 6]]) {
    await range.selectOption(String(minutes));
    await expect(panel.getByRole("img", { name: `近 ${minutes} 分钟输出速度趋势` })).toBeVisible();
    await expect(panel.getByText(`每点 ${seconds} 秒`, { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(range).toHaveValue("30");
  await expect(panel.getByText("每点 6 秒", { exact: true })).toBeVisible();
  await expect(panel.locator(".live-speed__throughput .data-chart__plot svg")).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath("live-trend-range.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const snapshot = await (await request.get("/api/live-speed/snapshot?minutes=30")).json();
  expect(snapshot.windowMs).toBe(3000);
  expect(snapshot.historyWindowMs).toBe(1_800_000);
  expect(snapshot.history).toHaveLength(300);
  expect((await request.get("/api/live-speed/snapshot?minutes=31")).status()).toBe(400);
});
