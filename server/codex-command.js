const { accessSync, constants, statSync } = require("fs");
const os = require("os");
const path = require("path");

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveCodexCommand(options = {}) {
  const env = options.env || process.env;
  if (env.CODEX_BIN) return env.CODEX_BIN;
  const home = options.home || os.homedir();
  const platform = options.platform || process.platform;
  const isExecutable = options.isExecutable || isExecutableFile;
  const candidates = (env.PATH || "").split(path.delimiter)
    .filter(Boolean).map((directory) => path.join(directory, "codex"));
  candidates.push(
    path.join(home, ".local/bin/codex"),
    path.join(home, ".npm-global/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  );
  // Background services do not inherit the desktop app's injected PATH.
  if (platform === "darwin") {
    for (const directory of ["/Applications", path.join(home, "Applications")]) {
      for (const app of ["Codex.app", "ChatGPT.app"]) {
        candidates.push(path.join(directory, app, "Contents/Resources/codex"));
        candidates.push(path.join(directory, app, "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"));
      }
    }
  }
  return candidates.find(isExecutable) || "codex";
}

module.exports = { resolveCodexCommand };
