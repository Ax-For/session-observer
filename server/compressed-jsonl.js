const fs = require("node:fs");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { createCompactJsonDecoder } = require("./compact-json-record");

// Node's streaming decoder stops after the first frame in a chunk. Walk the
// frame/block headers (RFC 8878) so each frame is decoded and checked separately.
async function* frames(handle, size) {
  const buffer = Buffer.allocUnsafe(8);
  async function header(position, length) {
    if (position + length > size || (await handle.read(buffer, 0, length, position)).bytesRead !== length) {
      throw new Error("Truncated zstd frame");
    }
  }
  for (let offset = 0; offset < size;) {
    const start = offset;
    await header(offset, 4);
    const magic = buffer.readUInt32LE(0);
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      await header(offset + 4, 4);
      offset += 8 + buffer.readUInt32LE(0);
      if (offset > size) throw new Error("Truncated zstd skippable frame");
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error("Invalid zstd frame");
    await header(offset + 4, 1);
    const descriptor = buffer[0], single = Boolean(descriptor & 0x20), flag = descriptor >> 6;
    const dictBytes = [0, 1, 2, 4][descriptor & 3], contentBytes = [single ? 1 : 0, 2, 4, 8][flag];
    offset += 5 + (single ? 0 : 1) + dictBytes + contentBytes;
    let last;
    do {
      await header(offset, 3);
      const block = buffer.readUIntLE(0, 3), type = (block >> 1) & 3, bytes = block >> 3;
      if (type === 3 || bytes > 128 * 1024) throw new Error("Invalid zstd block");
      last = block & 1;
      offset += 3 + (type === 1 ? 1 : bytes);
    } while (!last);
    if (descriptor & 4) offset += 4;
    if (offset > size) throw new Error("Truncated zstd frame");
    yield { start, end: offset - 1 };
  }
}

async function readCompressedJsonl(file, size, onRecord, { maxLineBytes = 128 * 1024, onMalformed = () => {} } = {}) {
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
    if (!stat.isFile() || stat.size !== size || size === 0) throw new Error("Archive changed while opening");
    for await (const frame of frames(handle, size)) {
      await pipeline(handle.createReadStream({ ...frame, autoClose: false, highWaterMark: 64 * 1024 }),
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
