const fs = require("node:fs");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const isDshCompressed = (file) => file.endsWith(".jsonl.zstd");
const decoderOptions = () => ({ chunkSize: 64 * 1024, maxOutputLength: MAX_FRAME_BYTES,
  params: { [zlib.constants.ZSTD_d_windowLogMax]: 24 } });

// Frame and block headers provide a compressed cursor even when an append ends
// partway through a frame. Offsets returned here are exclusive at the end.
function readZstdFrame(fd, start, size, header = Buffer.allocUnsafe(8)) {
  const read = (position, length) => position + length <= size && fs.readSync(fd, header, 0, length, position) === length;
  if (!read(start, 4)) return null;
  const magic = header.readUInt32LE(0);
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    if (!read(start + 4, 4)) return null;
    const end = start + 8 + header.readUInt32LE(0);
    return end <= size ? { start, end, skippable: true } : null;
  }
  if (magic !== 0xfd2fb528) throw new Error("Invalid zstd frame");
  if (!read(start + 4, 1)) return null;
  const descriptor = header[0], single = Boolean(descriptor & 0x20), flag = descriptor >> 6;
  let end = start + 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3] + [single ? 1 : 0, 2, 4, 8][flag];
  let last;
  do {
    if (!read(end, 3)) return null;
    const block = header.readUIntLE(0, 3), type = (block >> 1) & 3, bytes = block >> 3;
    if (type === 3 || bytes > 128 * 1024) throw new Error("Invalid zstd block");
    last = block & 1;
    end += 3 + (type === 1 ? 1 : bytes);
  } while (!last);
  if (descriptor & 4) end += 4;
  return end <= size ? { start, end } : null;
}

function frameBytes(fd, { start, end }) {
  const length = end - start;
  if (length > MAX_FRAME_BYTES) throw new Error("Compressed frame exceeds the read budget");
  const buffer = Buffer.allocUnsafe(length);
  if (fs.readSync(fd, buffer, 0, length, start) !== length) throw new Error("Compressed source changed while reading");
  return buffer;
}

async function decodeZstdFrame(fd, frame) {
  if (!zlib.zstdDecompress) throw new Error("Zstd requires Node.js 22.15 or newer");
  return promisify(zlib.zstdDecompress)(frameBytes(fd, frame), decoderOptions());
}

function* dshChunks(fd, size, status = {}) {
  if (!zlib.zstdDecompressSync) { status.skippedFrames = 1; return; }
  const header = Buffer.allocUnsafe(8);
  for (let offset = 0; offset < size;) {
    let frame;
    try { frame = readZstdFrame(fd, offset, size, header); }
    catch { status.skippedFrames = (status.skippedFrames || 0) + 1; return; }
    if (!frame) { status.partialFrame = true; return; }
    offset = frame.end;
    if (frame.skippable) continue;
    try { yield zlib.zstdDecompressSync(frameBytes(fd, frame), decoderOptions()); }
    catch {
      status.skippedFrames = (status.skippedFrames || 0) + 1;
      // Do not join records on opposite sides of unreadable data.
      yield Buffer.from("\n");
    }
  }
}

// Event locators for DSH use decompressed byte positions. They stay stable
// across appends and can be reopened without saving an uncompressed copy.
function readDshBytes(file, offset, length, onChunk) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("Source is not a regular file");
    let position = 0, read = 0;
    for (const chunk of dshChunks(fd, stat.size)) {
      const next = position + chunk.length;
      if (next > offset) {
        const piece = chunk.subarray(Math.max(0, offset - position), Math.min(chunk.length, offset + length - position));
        read += piece.length;
        if (onChunk(piece) === false || read >= length) break;
      }
      position = next;
    }
    return read;
  } finally { fs.closeSync(fd); }
}

module.exports = { isDshCompressed, readZstdFrame, decodeZstdFrame, dshChunks, readDshBytes };
