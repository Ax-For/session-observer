const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCodexCommand } = require("../server/codex-command");

function resolve(env, available, platform = "darwin") {
  return resolveCodexCommand({
    env, platform, home: "/home/test",
    isExecutable: (candidate) => available.includes(candidate),
  });
}

test("Codex discovery respects an explicit executable and PATH before desktop fallbacks", () => {
  assert.equal(resolve({ CODEX_BIN: "/custom/codex", PATH: "/bin" }, ["/bin/codex"]), "/custom/codex");
  assert.equal(resolve({ PATH: "/tools:/bin" }, ["/bin/codex", "/tools/codex"]), "/tools/codex");
});

test("Codex discovery finds desktop installations with a minimal service PATH", () => {
  for (const candidate of [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/home/test/Applications/Codex.app/Contents/Resources/codex",
    "/home/test/.local/bin/codex",
  ]) {
    assert.equal(resolve({ PATH: "/usr/bin:/bin" }, [candidate]), candidate);
  }
});

test("Codex discovery remains platform aware and leaves missing commands detectable", () => {
  assert.equal(resolve({}, ["/Applications/Codex.app/Contents/Resources/codex"], "linux"), "codex");
  assert.equal(resolve({}, []), "codex");
});

test("Codex discovery supports the nested CLI bundle used by current desktop installations", () => {
  const suffix = "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  for (const root of ["/Applications", "/home/test/Applications"]) {
    for (const app of ["ChatGPT.app", "Codex.app"]) {
      const candidate = `${root}/${app}/${suffix}`;
      assert.equal(resolve({ PATH: "/usr/bin:/bin" }, [candidate]), candidate);
      assert.equal(resolve({ PATH: "/usr/bin:/bin" }, [candidate], "linux"), "codex");
    }
  }
});

test("a nested desktop bundle does not override an explicit CLI or a PATH installation", () => {
  const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  assert.equal(resolve({ CODEX_BIN: "/custom/codex" }, [bundled]), "/custom/codex");
  assert.equal(resolve({ PATH: "/tools:/bin" }, [bundled, "/tools/codex"]), "/tools/codex");
});
