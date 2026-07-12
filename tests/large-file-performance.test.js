const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ObserverCore = require("../shared/observer-core");
const { queryRecentEvents } = require("../server/recent-events-reader");
const { statFile } = require("../server/source-files");

test("latest event lookup does not load a 400 MB sparse transcript into memory", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "observer-large-")), ".codex");
  fs.mkdirSync(dir);
  const file = path.join(dir, "00000000-0000-0000-0000-000000000099.jsonl");
  const sparseSize = 400 * 1024 * 1024;
  const fd = fs.openSync(file, "w");
  fs.ftruncateSync(fd, sparseSize);
  fs.writeSync(fd, "\n", sparseSize - 1, "utf8");
  fs.closeSync(fd);
  fs.appendFileSync(file, `${JSON.stringify({ timestamp: "2026-07-12T12:00:00Z", content: "latest event" })}\n`);
  const before = process.memoryUsage().heapUsed;
  const payload = queryRecentEvents({
    files: [statFile(file)],
    parsers: {
      parseCodexLineToEvent: (obj, context) => ({
        time: obj.timestamp,
        sessionId: context.sessionId,
        sourceFile: context.sourceFile,
        sourceType: "codex",
        callType: "Agent",
        content: obj.content,
      }),
    },
    filters: { order: "desc", mode: "observe", limit: 1 },
    limit: 1,
    eventMatchesModeCore: ObserverCore.eventMatchesMode,
    eventMatchesFiltersCore: ObserverCore.eventMatchesFilters,
  });
  const heapGrowth = process.memoryUsage().heapUsed - before;
  assert.equal(payload.events[0].content, "latest event");
  assert.equal(payload.scan.stoppedEarly, true);
  assert.ok(heapGrowth < 32 * 1024 * 1024, `heap grew by ${heapGrowth} bytes`);
});
