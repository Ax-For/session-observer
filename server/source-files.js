#!/usr/bin/env node
/**
 * Source file discovery helpers for session JSONL logs.
 */
const fs = require("fs");
const fsScanner = require("./fs-scanner");
const { loadCustomSources } = require("./custom-sources");
const { getNativeLocations } = require("./source-locations");

function statFile(file, stat = fs.statSync(file)) {
  return {
    file,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    signature: `${file}:${stat.size}:${stat.mtimeMs}`,
  };
}

function discover(roots, history = false) {
  const paths = new Set(), identities = new Set();
  const files = [];
  for (const root of roots) {
    if (root.archive && !history) continue;
    for (const file of fsScanner.listJsonlFiles(root.path, { zstd: history && root.sourceType === "codex" })) {
      if (paths.has(file)) continue;
      paths.add(file);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) continue;
        const identity = `${stat.dev}:${stat.ino}`;
        if (stat.ino && identities.has(identity)) continue;
        identities.add(identity);
        files.push({ ...statFile(file, stat), sourceType: root.sourceType, archive: Boolean(root.archive), format: file.endsWith(".zst") ? "zstd" : "jsonl" });
      } catch { /* File moved between enumeration and stat. */ }
    }
  }
  return files;
}

function listSourceFileRecords({ locations = getNativeLocations(), custom = loadCustomSources() } = {}) {
  const roots = [...locations, ...custom.flatMap((source) => source.directories.map((directory) => ({ path: directory, sourceType: source.key })))];
  return discover(roots).map((record) => ({ ...record, signature: `${record.signature}:${record.sourceType}` }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
}

function listHistoryFileRecords({ locations = getNativeLocations() } = {}) {
  // Prefer original, readable rollouts when a packed/archive copy is also present.
  return discover(locations, true).sort((a, b) => Number(a.archive) - Number(b.archive)
    || Number(a.format === "zstd") - Number(b.format === "zstd") || a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

function listSourceFiles() { return listSourceFileRecords().map((record) => record.file); }

function nativeSourceStatus(sourceType, records) {
  const locations = getNativeLocations().filter((row) => row.sourceType === sourceType).map(({ path, archive }) => {
    let exists = false;
    try { exists = fs.statSync(path).isDirectory(); } catch { /* Unavailable optional root. */ }
    return { path, archive, exists };
  });
  const visible = records.filter((row) => row.sourceType === sourceType);
  const updatedAt = visible.reduce((latest, row) => Math.max(latest, row.mtimeMs), 0);
  return { path: locations.find((row) => !row.archive && row.exists)?.path || locations[0]?.path, locations,
    exists: locations.some((row) => row.exists && !row.archive), files: visible.length,
    bytes: visible.reduce((size, row) => size + row.size, 0), updatedAt: updatedAt ? new Date(updatedAt).toISOString() : "" };
}

function aggregateRecordsKey(records, prefix = "sources") {
  return `${prefix}|${(records || []).map((record) => record.signature).join("|")}`;
}

module.exports = {
  aggregateRecordsKey,
  listSourceFiles,
  listSourceFileRecords,
  listHistoryFileRecords,
  nativeSourceStatus,
  statFile,
};
