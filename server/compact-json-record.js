const fs = require("node:fs");
const { parser } = require("stream-json");
const { isDshCompressed, readDshBytes } = require("./zstd-frames");

// Decode metadata after large image/tool payloads without packing those strings.
function createCompactJsonDecoder(options = {}) {
  const stringLimit = options.stringLimit || 64 * 1024;
  const retainedLimit = 512 * 1024;
  const stack = [];
  let root;
  let scalar = "";
  let scalarKind = "";
  let scalarLength = 0;
  let scalarPath = [];
  let retained = 0;
  let nodes = 0;
  let truncated = false;
  let textTruncated = false;
  let error;
  const decoder = parser({ packValues: false, streamValues: true });
  const nextPath = () => {
    const parent = stack.at(-1);
    return parent ? [...parent.path, Array.isArray(parent.value) ? parent.value.length : parent.key] : [];
  };
  const attach = (value) => {
    if (++nodes > 16000) throw new Error("JSON record structure exceeds the bounded parser budget");
    const parent = stack.at(-1);
    if (!parent) { root = value; return; }
    if (Array.isArray(parent.value)) parent.value.push(value);
    else Object.defineProperty(parent.value, parent.key, { value, enumerable: true, writable: true, configurable: true });
  };
  decoder.on("error", (cause) => { error = cause; });
  decoder.on("data", ({ name, value }) => {
    if (name === "startObject" || name === "startArray") {
      if (stack.length >= 64) throw new Error("JSON record nesting exceeds the bounded parser budget");
      const container = name === "startArray" ? [] : {};
      const path = nextPath();
      attach(container);
      stack.push({ value: container, key: "", path });
    } else if (name === "endObject" || name === "endArray") stack.pop();
    else if (name === "startKey" || name === "startString" || name === "startNumber") {
      scalar = "";
      scalarLength = 0;
      scalarKind = name;
      if (name === "startString") {
        scalarPath = nextPath();
        options.onString?.(scalarPath, "", "start");
      }
    } else if (name === "stringChunk" || name === "numberChunk") {
      scalarLength += value.length;
      if (scalarKind === "startString") options.onString?.(scalarPath, value, "chunk");
      const binary = /^(data|encrypted_content|image_url)$/.test(stack.at(-1)?.key || "");
      const limit = scalarKind === "startKey" ? 256 : scalarKind === "startNumber" ? 128 : binary ? 128 : stringLimit;
      if (scalarKind !== "startString" && scalarLength > limit) throw new Error("JSON key or number exceeds the parser budget");
      const portion = value.slice(0, Math.max(0, Math.min(limit - scalar.length, scalarKind === "startString" ? retainedLimit - retained : limit)));
      scalar += portion;
      retained += portion.length;
    } else if (name === "endKey") {
      if (scalar.length !== scalarLength) throw new Error("JSON metadata exceeds the retained budget");
      stack.at(-1).key = scalar;
    } else if (name === "endString") {
      options.onString?.(scalarPath, "", "end");
      const shortened = scalar.length < scalarLength;
      truncated ||= shortened;
      textTruncated ||= shortened && !/^(data|encrypted_content|image_url)$/.test(stack.at(-1)?.key || "");
      attach(shortened ? `${scalar}\n[content truncated: ${scalarLength} characters]` : scalar);
      scalarKind = "";
    } else if (name === "endNumber") {
      if (scalar.length !== scalarLength || !Number.isFinite(Number(scalar))) throw new Error("Invalid JSON number");
      attach(Number(scalar));
      scalarKind = "";
    } else if (["trueValue", "falseValue", "nullValue"].includes(name)) attach(value);
  });
  function write(chunk) {
    decoder.write(chunk);
    if (decoder.errored || error) throw decoder.errored || error;
  }
  function finish() {
    decoder.end("\n");
    if (decoder.errored || error) throw decoder.errored || error;
    if (stack.length || scalarKind === "startString" || !root || typeof root !== "object") throw new Error("Incomplete JSON record");
    return { value: root, truncated, textTruncated };
  }
  function close() {
    // Stream close events run on the next tick. A synchronous JSONL scan can
    // create thousands of decoders before that tick; detach captured records now.
    decoder.removeAllListeners("data");
    decoder.removeAllListeners("error");
    decoder.on("error", () => {});
    root = undefined;
    scalar = "";
    stack.length = 0;
    decoder.destroy();
  }
  return { write, finish, close };
}

function readCompactJsonRecord(file, offset, length, options = {}) {
  if (isDshCompressed(file)) {
    const decoder = createCompactJsonDecoder(options);
    try {
      const read = readDshBytes(file, offset, length, (chunk) => decoder.write(chunk));
      if (read !== length) throw new Error("JSON source changed while reading");
      return decoder.finish();
    } finally { decoder.close(); }
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const decoder = createCompactJsonDecoder(options);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("JSON source is not a regular file");
    const buffer = Buffer.allocUnsafe(16 * 1024);
    for (let position = offset; position < offset + length;) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, offset + length - position), position);
      if (!bytes) throw new Error("JSON source changed while reading");
      decoder.write(buffer.subarray(0, bytes));
      position += bytes;
    }
    return decoder.finish();
  } finally { decoder.close(); fs.closeSync(fd); }
}

module.exports = { readCompactJsonRecord, createCompactJsonDecoder };
