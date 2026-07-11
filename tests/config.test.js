const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("config import does not build the frontend until server startup requests it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-config-"));
  const serverDir = path.join(root, "server");
  fs.mkdirSync(serverDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", "server", "config.js"), path.join(serverDir, "config.js"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "config-build-fixture",
    private: true,
    scripts: {
      build: "node build.js",
    },
  }));
  fs.writeFileSync(path.join(root, "build.js"), [
    "const fs = require('node:fs');",
    "fs.mkdirSync('dist', { recursive: true });",
    "fs.writeFileSync('dist/index.html', '<!doctype html>');",
    "fs.writeFileSync('build-ran', 'yes');",
  ].join("\n"));

  const probe = spawnSync(process.execPath, ["-e", [
    "const fs = require('node:fs');",
    "const config = require('./server/config');",
    "if (fs.existsSync('build-ran')) process.exit(11);",
    "if (config.STATIC_ROOT !== require('node:path').join(process.cwd(), 'dist')) process.exit(12);",
    "config.ensureFrontendBuild();",
    "if (!fs.existsSync('dist/index.html')) process.exit(13);",
    "if (!fs.existsSync('build-ran')) process.exit(14);",
  ].join("\n")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});
