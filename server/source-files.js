#!/usr/bin/env node
/**
 * Source file discovery helpers for session JSONL logs.
 */
const fs = require("fs");
const config = require("./config");
const fsScanner = require("./fs-scanner");
const { loadCustomSources } = require("./custom-sources");

function statFile(file) {
  const stat = fs.statSync(file);
  return {
    file,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    signature: `${file}:${stat.size}:${stat.mtimeMs}`,
  };
}

function listSourceFiles() {
  return [
    ...fsScanner.listJsonlFiles(config.SESSIONS_DIR),
    ...fsScanner.listJsonlFiles(config.CLAUDE_PROJECTS_DIR),
    ...loadCustomSources().flatMap((source) => source.directories.flatMap((directory) => fsScanner.listJsonlFiles(directory))),
  ];
}

function listSourceFileRecords() {
  return listSourceFiles()
    .map((file) => {
      try {
        return statFile(file);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) return right.mtimeMs - left.mtimeMs;
      return String(right.file).localeCompare(String(left.file));
    });
}

function aggregateRecordsKey(records, prefix = "sources") {
  return `${prefix}|${(records || []).map((record) => record.signature).join("|")}`;
}

module.exports = {
  aggregateRecordsKey,
  listSourceFiles,
  listSourceFileRecords,
  statFile,
};
