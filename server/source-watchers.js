const fs = require("fs");
const path = require("path");
const config = require("./config");
const sourceFiles = require("./source-files");

function createSourceWatchers(onChange, { onFileChange, onRecords } = {}) {
  const handles = new Map();
  let signature = "";
  let lastCheckedAt = "";
  let lastChangeAt = "";
  let lastError = "";
  const changed = (reason) => { lastChangeAt = new Date().toISOString(); onChange(reason); };
  function reconcile() {
    try {
      const targets = [config.SESSIONS_DIR, config.CLAUDE_PROJECTS_DIR, path.dirname(config.STATE_DB)];
      for (const target of targets) {
        if (!fs.existsSync(target) && handles.has(target)) { handles.get(target).close(); handles.delete(target); }
        if (!fs.existsSync(target) || handles.has(target)) continue;
        try {
          const watcher = fs.watch(target, { recursive: target !== path.dirname(config.STATE_DB) }, (_event, filename) => {
            if (target === path.dirname(config.STATE_DB) && filename && !/state_.*sqlite|session_index\.jsonl/.test(String(filename))) return;
            if (filename) onFileChange?.(path.join(target, String(filename)));
            changed("watch");
          });
          watcher.on("error", () => { watcher.close(); handles.delete(target); });
          handles.set(target, watcher);
        } catch { /* Signature reconciliation remains active on unsupported filesystems. */ }
      }
      const records = sourceFiles.listSourceFileRecords();
      onRecords?.(records);
      const metadata = [config.STATE_DB, `${config.STATE_DB}-wal`, config.CODEX_SESSION_INDEX].map((file) => {
        try { const stat = fs.statSync(file); return `${file}:${stat.size}:${stat.mtimeMs}`; } catch { return `${file}:missing`; }
      });
      const next = records.map((record) => `${record.file}:${record.signature}`).join("|") + metadata.join("|");
      if (signature && signature !== next) changed("reconcile");
      signature = next;
      lastCheckedAt = new Date().toISOString();
      lastError = "";
    } catch (error) { lastError = String(error.message || error); }
  }
  reconcile();
  const timer = setInterval(reconcile, 30_000);
  timer.unref?.();
  return {
    state: () => ({ watchedPaths: [...handles.keys()], lastCheckedAt, lastChangeAt, lastError, reconcileIntervalMs: 30000 }),
    reconcile,
    close: () => { clearInterval(timer); for (const handle of handles.values()) handle.close(); handles.clear(); },
  };
}

module.exports = { createSourceWatchers };
