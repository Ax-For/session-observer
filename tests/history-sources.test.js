const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveSourceLocations } = require("../server/source-locations");
const { listSourceFileRecords, listHistoryFileRecords } = require("../server/source-files");

test("native locations include extra roots and Codex archives without following nested symlinks or counting overlapping files twice", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-roots-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = path.join(root, "home", "sessions");
  const nested = path.join(sessions, "nested");
  const archive = path.join(root, "home", "archived_sessions");
  const extra = path.join(root, "another-codex-home", "sessions");
  const claude = path.join(root, "third-party-claude");
  const alias = path.join(root, "alias");
  for (const dir of [nested, archive, extra, claude]) fs.mkdirSync(dir, { recursive: true });
  const ordinary = path.join(nested, "a.jsonl");
  const extraFile = path.join(extra, "b.jsonl");
  const claudeFile = path.join(claude, "c.jsonl");
  const packed = path.join(archive, "old.jsonl.zst");
  for (const file of [ordinary, extraFile, claudeFile, packed]) fs.writeFileSync(file, "\n");
  fs.symlinkSync(extra, alias, "dir");
  fs.symlinkSync(archive, path.join(nested, "linked-archive"), "dir");
  fs.linkSync(ordinary, path.join(extra, "hard-link.jsonl"));
  const locations = resolveSourceLocations({ codex: sessions, claude, manifest: { codex: ["default", nested, extra, alias] } });
  const active = listSourceFileRecords({ locations, custom: [] });
  assert.deepEqual(new Set(active.map((row) => row.file)), new Set([fs.realpathSync(ordinary), fs.realpathSync(extraFile), fs.realpathSync(claudeFile)]));
  assert.equal(active.find((row) => row.file === fs.realpathSync(claudeFile)).sourceType, "claude");
  const historical = listHistoryFileRecords({ locations });
  assert.equal(historical.length, 4);
  assert.equal(historical.find((row) => row.file === fs.realpathSync(packed)).format, "zstd");
  assert.equal(historical.find((row) => row.file === fs.realpathSync(packed)).sourceType, "codex");
  assert.equal(locations.filter((row) => !row.archive && row.sourceType === "codex").length, 3);
});

test("an explicit source list can replace its default and refuses relative paths", () => {
  const options = { codex: "/unused/codex/sessions", claude: "/unused/claude/projects" };
  assert.deepEqual(resolveSourceLocations({ ...options, manifest: { codex: ["/chosen/logs"] } }).filter((r) => r.sourceType === "codex").map((r) => r.path), ["/chosen/logs"]);
  assert.throws(() => resolveSourceLocations({ ...options, manifest: { codex: ["../logs"] } }), /absolute/i);
});

test("changing a directory's native parser also changes its summary cache signature", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-root-parser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "session.jsonl"), "{}\n");
  const codex = listSourceFileRecords({ locations: [{ path: root, sourceType: "codex" }], custom: [] });
  const claude = listSourceFileRecords({ locations: [{ path: root, sourceType: "claude" }], custom: [] });
  assert.notEqual(codex[0].signature, claude[0].signature);
});

test("Qwen Code discovers chat transcripts, with archived chats restricted to history", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-qwen-roots-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chats = path.join(root, "project", "chats");
  const active = path.join(chats, "active.jsonl");
  const archive = path.join(chats, "archive", "older.jsonl");
  const unrelated = path.join(root, "project", "internal.jsonl");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  for (const file of [active, archive, unrelated]) fs.writeFileSync(file, "{}\n");
  fs.symlinkSync(unrelated, path.join(chats, "linked.jsonl"));
  const locations = resolveSourceLocations({ qwen: root });
  const files = listSourceFileRecords({ locations, custom: [] });
  assert.deepEqual(files.map((row) => [row.file, row.sourceType]), [[fs.realpathSync(active), "qwen"]]);
  assert.deepEqual(listHistoryFileRecords({ locations }).map((row) => [row.file, row.archive]),
    [[fs.realpathSync(active), false], [fs.realpathSync(archive), true]]);
});
