#!/usr/bin/env node
/**
 * Detect Claude Code and Codex versions at startup.
 */
const { spawnSync } = require("child_process");
const { resolveCodexCommand } = require("./codex-command");

const worker = process.argv.includes("--query-worker");
let claudeVersion = process.env.OBSERVER_CLAUDE_VERSION || "unknown";
if (!worker) try {
  const proc = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    claudeVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }

let codexVersion = process.env.OBSERVER_CODEX_VERSION || "unknown";
if (!worker) try {
  const proc = spawnSync(resolveCodexCommand(), ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    codexVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }

module.exports = { claudeVersion, codexVersion };
