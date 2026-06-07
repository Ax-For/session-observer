const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceChangeBus } = require("../server/source-change-bus");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("source change bus debounces source notifications", async () => {
  const bus = createSourceChangeBus({ debounceMs: 10 });
  const events = [];
  bus.subscribe((event) => events.push(event));

  bus.notify("watch");
  bus.notify("session-rename");
  await wait(30);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "source-changed");
  assert.equal(events[0].version, 1);
  assert.deepEqual(events[0].reasons, ["watch", "session-rename"]);
  assert.equal(bus.state().listenerCount, 1);

  bus.close();
});

test("source change bus flushes pending notifications", () => {
  const bus = createSourceChangeBus({ debounceMs: 1000 });
  const events = [];
  bus.subscribe((event) => events.push(event));

  bus.notify("delete");
  const flushed = bus.flush();

  assert.equal(events.length, 1);
  assert.equal(flushed.version, 1);
  assert.equal(flushed.reason, "delete");
  assert.equal(bus.state().reason, "delete");

  bus.close();
});
