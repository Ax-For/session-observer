const { createHash } = require("node:crypto");

function toolDigest(args) {
  const text = typeof args === "string" ? args : JSON.stringify(args ?? null);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function toolSignal(actions, now, availableSince = 0) {
  const since = Math.max(now - 600_000, availableSince);
  const recent = actions.filter((action) => !action.seeded && action.callMs >= since);
  const latest = recent.at(-1);
  if (!latest || now - latest.callMs >= 120_000) return null;
  const target = (kind, action) => ({ kind, callId: action.callId, tool: action.tool });
  if (latest.failed === false && recent.slice(-6, -1).some((action) => action.tool === latest.tool && action.failed === true)) {
    return target("recovered", latest);
  }

  let strongest = null;
  for (const width of [1, 2, 3]) {
    let length = 0;
    for (let index = recent.length - width - 1; index >= 0; index--) {
      const left = recent[index], right = recent[index + width];
      if (!left.digest || left.tool !== right.tool || left.digest !== right.digest) break;
      length++;
    }
    const repeats = Math.floor(length / width) + 1;
    if (repeats < 3) continue;
    const run = recent.slice(-repeats * width);
    const failure = run.findLast((action) => action.failed === true);
    const signal = { ...target(failure ? "looping" : "repeating", failure || latest), repeats };
    if (!strongest || (failure && strongest.kind === "repeating") ||
      (signal.kind === strongest.kind && repeats > strongest.repeats)) strongest = signal;
  }
  return strongest;
}

module.exports = { toolDigest, toolSignal };
