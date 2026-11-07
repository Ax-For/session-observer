const fs = require("node:fs");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { createCompactJsonDecoder } = require("./compact-json-record");
const { readZstdFrame } = require("./zstd-frames");

// Node's streaming decoder stops after the first frame in a chunk. Walk the
// frame/block headers (RFC 8878) so each frame is decoded and checked separately.
async function readCompressedJsonl(file, size, onRecord, { maxLineBytes = 128 * 1024, onMalformed = () => {}, allowPartial = false } = {}) {
  if (!zlib.createZstdDecompress) throw new Error("Zstd requires Node.js 22.15 or newer");
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let parts = [], bytes = 0, decoder, malformed = false;
  function feed(part) {
    if (!part.length || malformed) return;
    bytes += part.length;
    try {
      if (bytes > maxLineBytes && !decoder) {
        decoder = createCompactJsonDecoder({ stringLimit: 8192 });
        for (const prefix of parts) decoder.write(prefix);
        parts = [];
      }
      if (decoder) decoder.write(part);
      else parts.push(part);
    } catch { malformed = true; decoder?.close(); decoder = null; parts = []; }
  }
  function line() {
    try {
      if (malformed) { onMalformed(); return; }
      let value;
      try {
        if (decoder) value = decoder.finish().value;
        else {
          const text = Buffer.concat(parts, bytes).toString("utf8").trim();
          if (text) value = JSON.parse(text);
        }
      } catch { onMalformed(); return; }
      if (value !== undefined) onRecord(value, Boolean(decoder));
    } finally { decoder?.close(); decoder = null; parts = []; bytes = 0; malformed = false; }
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < size || (!allowPartial && (stat.size !== size || size === 0))) throw new Error("Archive changed while opening");
    const header = Buffer.allocUnsafe(8);
    for (let offset = 0; offset < size;) {
      const frame = readZstdFrame(handle.fd, offset, size, header);
      if (!frame) {
        if (allowPartial) return { endedWithNewline: false };
        throw new Error("Truncated zstd frame");
      }
      offset = frame.end;
      if (frame.skippable) continue;
      await pipeline(handle.createReadStream({ start: frame.start, end: frame.end - 1, autoClose: false, highWaterMark: 64 * 1024 }),
        zlib.createZstdDecompress({ chunkSize: 64 * 1024, params: { [zlib.constants.ZSTD_d_windowLogMax]: 24 } }),
        async (decoded) => {
          for await (const chunk of decoded) {
            let cursor = 0;
            for (let newline; (newline = chunk.indexOf(10, cursor)) !== -1; cursor = newline + 1) {
              feed(chunk.subarray(cursor, newline));
              line();
            }
            feed(chunk.subarray(cursor));
          }
        });
    }
    return { endedWithNewline: !bytes && !malformed };
  } finally { decoder?.close(); await handle.close(); }
}

module.exports = { readCompressedJsonl };
