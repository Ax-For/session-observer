const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readCompactJsonRecord } = require("../server/compact-json-record");

function fixture(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-large-record-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "record.jsonl");
  fs.writeFileSync(file, text);
  return file;
}

test("bounded JSON parser preserves trailing usage and Unicode after a large image", (t) => {
  const text = JSON.stringify({ message: { content: [{ type: "image", source: { data: "A".repeat(2 * 1024 * 1024) } },
    { type: "text", text: "图片后的中文\n🙂" }], usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 678 } } });
  const result = readCompactJsonRecord(fixture(t, text), 0, Buffer.byteLength(text));
  assert.deepEqual(result.value.message.usage, { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 678 });
  assert.equal(result.value.message.content[1].text, "图片后的中文\n🙂");
  assert.ok(result.value.message.content[0].source.data.length < 200);
  assert.equal(result.truncated, true);
});

test("bounded parser rejects incomplete and excessive structures", (t) => {
  for (const text of ['{"message":"unfinished', '{"a":true invalid}', "[".repeat(70) + "0" + "]".repeat(70)]) {
    assert.throws(() => readCompactJsonRecord(fixture(t, text), 0, Buffer.byteLength(text)));
  }
});

test("bounded parser handles escaped keys without prototype mutation", (t) => {
  const text = '{"__proto__":{"polluted":true},"text":"\\u4e2d\\u6587","n":1.25e3,"ok":false,"none":null}';
  const result = readCompactJsonRecord(fixture(t, text), 0, text.length);
  assert.equal(result.value.text, "中文");
  assert.equal(result.value.n, 1250);
  assert.equal(result.value.ok, false);
  assert.equal({}.polluted, undefined);
});

test("synchronous scans release large decoded records before stream close callbacks run", (t) => {
  const text = JSON.stringify({ text: "x".repeat(512 * 1024), usage: { input: 100 } });
  const file = fixture(t, text);
  const script = `const {readCompactJsonRecord}=require(${JSON.stringify(require.resolve("../server/compact-json-record"))});
    global.gc(); const before=process.memoryUsage().heapUsed;
    for(let i=0;i<800;i++) readCompactJsonRecord(${JSON.stringify(file)},0,${Buffer.byteLength(text)});
    global.gc(); console.log(process.memoryUsage().heapUsed-before);`;
  const result = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=96", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Number(result.stdout.trim()) < 24 * 1024 * 1024, result.stdout);
});
