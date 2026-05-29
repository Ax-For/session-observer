#!/usr/bin/env node
/**
 * Detect Claude Code and Codex versions at startup.
 */
const { spawnSync } = require("child_process");

let claudeVersion = "unknown";
try {
  const proc = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    claudeVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }

let codexVersion = "unknown";
try {
  const proc = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    codexVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }

module.exports = { claudeVersion, codexVersion };
