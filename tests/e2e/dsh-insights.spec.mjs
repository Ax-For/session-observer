import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";

test("compressed DSH sessions feed live speed, retained usage, tool replay and dialogue search", async ({ page, request }, testInfo) => {
  const { dsh } = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "observer-e2e-live-8878.json"), "utf8"));
  const sessionId = `dsh-${testInfo.project.name}`;
  const folder = path.join(dsh, sessionId);
  const file = path.join(folder, "session.v4.jsonl.zstd");
  const keyword = `DSH已完成校验${testInfo.project.name}`;
  const append = (...rows) => {
    for (const row of rows) fs.appendFileSync(file, zstdCompressSync(Buffer.from(JSON.stringify(row) + "\n")));
  };
  try {
    const theme = testInfo.project.name === "desktop-1440" ? "dark" : "light";
    await page.addInitScript((value) => localStorage.setItem("observer-theme-mode", JSON.stringify(value)), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?tab=overview");
    const panel = page.getByTestId("live-speed-panel");
    await expect(panel.getByRole("status")).toHaveText("实时连接");
    fs.mkdirSync(folder, { recursive: true });
    const started = Date.now() - 2000;
    let seq = 0;
    const row = (type, time, data = {}) => ({ type, seq: ++seq, time, data });
    append({ type: "session", version: 4, id: sessionId, createdAt: started - 1000, cwd: "/fixture/dsh" },
      row("user/message", started - 500, { content: [{ type: "text", text: "校验压缩会话" }] }), row("step/start", started));
    await expect(panel.getByRole("button", { name: `查看会话 ${sessionId}` })).toContainText("生成中");
    for (let i = 1; i <= 3; i++) {
      const callId = `${sessionId}-tool-${i}`;
      append(row("tool/call", started + i * 100, { callId, name: "validate_log", arguments: { mode: "check" } }),
        row("tool/result", started + i * 100 + 5, { message: { toolCallId: callId, isError: true, content: [{ type: "text", text: "校验失败" }] } }));
    }
    append(row("assistant/message", Date.now(), {
      message: { id: `${sessionId}-answer`, source: { model: "deepseek-v4-pro" },
        content: [{ type: "text", text: "检查记录。".repeat(12_000) + keyword }] },
      usage: { inputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 20, outputTokens: 60 },
    }));
    await expect.poll(async () => {
      const snapshot = await (await request.get("/api/live-speed/snapshot")).json();
      return snapshot.agents.some((agent) => agent.sessionId === sessionId && agent.recentRate > 0);
    }).toBe(true);
    const warning = panel.locator(".live-speed__session-row").filter({
      has: page.getByRole("button", { name: `查看会话 ${sessionId}`, exact: true }),
    }).getByRole("button", { name: /重复失败.*查看工具回放/ });
    await expect(warning).toBeInViewport({ ratio: 1 });
    await panel.screenshot({ path: testInfo.outputPath("dsh-live.png") });

    const refresh = await request.post("/api/usage-history/refresh", { headers: { "X-Observer-Request": "1" } });
    expect(refresh.status()).toBe(202);
    await expect.poll(async () => {
      const data = await (await request.get("/api/usage-history?source=dsh")).json();
      return data.totals.output >= 60 && data.totals.measured >= 1;
    }, { timeout: 15_000 }).toBe(true);

    await expect(warning).toBeVisible();
    await warning.click();
    await expect(page.getByRole("tab", { name: "回放", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".session-replay-step.is-focused")).toContainText("validate_log");
    await page.goto("/?tab=stream&platform=dsh");
    await page.getByRole("textbox", { name: "搜索", exact: true }).fill(keyword);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const hit = page.locator(".event-row__open").filter({ hasText: keyword }).first();
    await expect(hit.locator("mark")).toHaveText(keyword);
    await hit.click();
    await expect(page.locator("[data-search-target] mark").first()).toHaveText(keyword);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
