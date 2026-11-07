const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zstdCompressSync, constants: zstd } = require("node:zlib");
const { parseDshLineToEvent, tokenInputTotal, tokenCountedTotal } = require("../shared/observer-core");
const { buildResponsePerformance } = require("../shared/response-performance");
const { buildExecutionReplay } = require("../shared/session-insights");
const { createLiveSpeedMonitor } = require("../server/live-speed-monitor");
const { forEachCompleteJsonlLine, readJsonlLineAtOffset } = require("../server/fs-scanner");

const now = Date.parse("2026-11-07T08:00:10Z");
const header = { type: "session", version: 4, id: "dsh-child", createdAt: now - 9000, cwd: "/fixture/dsh", origin: "subagent", parentSession: "dsh-parent" };
const event = (type, seq, offset, data = {}) => ({ type, seq, time: now + offset, data });
const prompt = event("user/message", 1, -4000, { content: [{ type: "text", text: "DSH example" }] });
const start = event("step/start", 2, -2000);
const answer = event("assistant/message", 3, 0, { message: { id: "response-id", source: { model: "deepseek-v4-pro" }, content: [{ type: "text", text: "DSH answer" }] },
  usage: { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 4, outputTokens: 30 } });

test("DSH snapshots unwrap events, discard inherited turns and account for cached input once", () => {
  const copied = { ...answer, time: now - 40_000, seq: 0 };
  const events = parseDshLineToEvent({ type: "snapshot", header, records: [copied, { type: "event", event: prompt }, start, answer] }, { sourceFile: "session.v4.jsonl.zstd" });
  assert.equal(events.filter((item) => item.callType === "Agent").length, 1);
  assert.ok(events.every((item) => item.sessionId === "dsh-child" && item.parentSessionId === "dsh-parent" && item.isSubagent));
  const usage = events.find((item) => item.tokenUsage).tokenUsage;
  assert.equal(tokenInputTotal(usage, "dsh"), 104);
  assert.equal(tokenCountedTotal(usage, "dsh"), 134);
  assert.deepEqual(buildResponsePerformance(events).responses.map((row) => [row.durationMs, row.outputTokens, row.firstContentMs]), [[2000, 30, null]]);
});

test("plain DSH journals expose tool failure and keep responses without request boundaries unmeasured", () => {
  const context = { sourceFile: "session.v3.jsonl" };
  const rows = [
    null, header,
    event("session/title", 1, -4500, { title: "Read-only journal" }),
    event("user/message", 2, -4000, { content: "Run a tool" }),
    event("turn/start", 3, -3500, { turn: 1 }),
    event("tool/call", 4, -3000, { name: "check", callId: "check-1", arguments: "flags" }),
    event("tool/result", 5, -2800, { message: { toolCallId: "check-1", isError: true, content: [{ type: "text", text: "error" }] } }),
    { ...answer, seq: 6, time: now - 1500, data: {
      message: { id: "missing-start", content: [{ type: "reasoning", text: "checking" }, { type: "text", text: "done" }] },
      usage: { totalTokens: 20, outputTokens: 5 },
    } },
    event("turn/end", 7, 0),
  ];
  const events = [...rows, rows[6]].flatMap((row) => parseDshLineToEvent(row, context));
  assert.equal(events.filter((item) => item.callType === "Agent").length, 1);
  assert.equal(events.find((item) => item.callType === "Agent").sessionTitle, "Read-only journal");
  assert.equal(buildExecutionReplay(events).steps.find((step) => step.kind === "tool-call").status, "error");
  assert.equal(buildResponsePerformance(events).responses[0].durationMs, null);
});

test("DSH live monitor resumes a partial compressed frame and indexes records across frames", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-dsh-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "session.v4.jsonl.zstd");
  const encode = (text) => zstdCompressSync(Buffer.from(text));
  const line = (row) => JSON.stringify(row) + "\n";
  const reply = line(answer);
  const first = encode(line(header) + line(prompt) + line(start) + reply.slice(0, 25));
  const second = encode(reply.slice(25));
  fs.writeFileSync(file, Buffer.concat([first, second.subarray(0, 6)]));
  const monitor = createLiveSpeedMonitor({ roots: [{ path: root, sourceType: "dsh" }], clock: () => now });
  t.after(() => monitor.close());
  monitor.notify(file);
  await monitor.tick();
  assert.equal(monitor.snapshot().agents[0].phase, "generating");
  assert.equal(monitor.snapshot().measuredResponses, 0);
  fs.appendFileSync(file, second.subarray(6));
  await monitor.tick();
  await monitor.tick();
  assert.equal(monitor.snapshot().agents[0].phase, "idle");
  assert.equal(monitor.snapshot().measuredResponses, 1);
  assert.equal(monitor.snapshot().sources.find((row) => row.sourceType === "dsh").measured, 10);
  const rows = [];
  forEachCompleteJsonlLine(file, (text, _line, locator) => rows.push({ text, locator }));
  assert.equal(rows.length, 4);
  assert.deepEqual(JSON.parse(readJsonlLineAtOffset(file, rows[3].locator.byteOffset)), answer);
});

test("DSH scan keeps complete records around a bad frame and leaves a partial last frame unread", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-dsh-frames-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "session.v4.jsonl.zstd");
  const encode = (obj) => zstdCompressSync(Buffer.from(JSON.stringify(obj) + "\n"), { params: { [zstd.ZSTD_c_checksumFlag]: 1 } });
  const bad = encode(prompt);
  bad[bad.length - 1] ^= 1;
  const skippable = Buffer.alloc(8);
  skippable.writeUInt32LE(0x184d2a50, 0);
  fs.writeFileSync(file, Buffer.concat([encode(header), skippable, bad, encode(start), encode(answer).subarray(0, 4)]));
  const records = [];
  const scan = forEachCompleteJsonlLine(file, (line) => { if (line) records.push(JSON.parse(line)); });
  assert.deepEqual(records, [header, start]);
  assert.equal(scan.skippedFrames, 1);
  assert.equal(scan.endedWithNewline, false);
});
