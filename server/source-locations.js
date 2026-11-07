const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");

function canonical(directory) {
  try { return fs.realpathSync(directory); } catch { return path.resolve(directory); }
}

function resolveSourceLocations({ codex, claude, manifest = {}, codexConfig }) {
  const roots = [];
  const seen = new Set();
  for (const [sourceType, fallback] of Object.entries({ codex, claude })) {
    const locations = manifest[sourceType] ?? ["default"];
    if (!Array.isArray(locations) || locations.length < 1 || locations.length > 8) {
      throw new RangeError("Each source needs one to eight locations");
    }
    const archives = [];
    function add(directory, archive = false, configFile) {
      const resolved = canonical(directory);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      roots.push({ path: resolved, sourceType, archive, configFile });
    }
    for (const entry of locations) {
      if (typeof entry !== "string" || entry.length > 4096 || entry.includes("\0") || (entry !== "default" && !path.isAbsolute(entry))) {
        throw new RangeError("Source locations must be absolute paths or default");
      }
      const directory = path.resolve(entry === "default" ? fallback : entry);
      const name = path.basename(directory);
      const archive = sourceType === "codex" && name === "archived_sessions";
      const configFile = sourceType === "codex" ? (entry === "default" && codexConfig) ||
        (["sessions", "archived_sessions"].includes(name) ? path.join(path.dirname(directory), "config.toml") : undefined) : undefined;
      add(directory, archive, configFile);
      if (sourceType === "codex" && name === "sessions") archives.push(path.join(path.dirname(directory), "archived_sessions"));
    }
    for (const directory of archives) add(directory, true);
  }
  return roots;
}

function readSmallFile(file, limit = 64 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new RangeError("Configuration file is too large or is not a regular file");
    const bytes = Buffer.allocUnsafe(limit + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > limit) throw new RangeError("Configuration file is too large");
    return bytes.toString("utf8", 0, count);
  } finally { fs.closeSync(fd); }
}

let nativeLocations;
function getNativeLocations() {
  if (nativeLocations) return nativeLocations;
  const options = { codex: config.SESSIONS_DIR, claude: config.CLAUDE_PROJECTS_DIR, codexConfig: config.CODEX_CONFIG_FILE };
  try {
    const manifest = JSON.parse(readSmallFile(config.SOURCE_LOCATIONS_FILE));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new RangeError("Expected a source locations object");
    nativeLocations = resolveSourceLocations({ ...options, manifest });
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[sources] Invalid source locations file; using default directories.");
    nativeLocations = resolveSourceLocations(options);
  }
  return nativeLocations;
}

function locationFor(file, roots = getNativeLocations()) {
  return roots.find((root) => {
    const relative = path.relative(root.path, file);
    return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
}

module.exports = { resolveSourceLocations, getNativeLocations, locationFor, readSmallFile };
