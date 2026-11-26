import { expect, test } from "vitest";
import { mergeEventPages } from "./event-pages";

test("incremental refresh preserves historical rows and replaces duplicate previews", () => {
  const old = [{ eventId: "a", time: "2026-01-01", content: "old" }, { eventId: "b", time: "2026-01-02", content: "preview" }];
  const next = [{ eventId: "b", time: "2026-01-02", content: "complete" }, { eventId: "c", time: "2026-01-03", content: "new" }];
  expect(mergeEventPages(old, next).map((event) => event.content)).toEqual(["new", "complete", "old"]);
  expect(mergeEventPages(old, next, "desc", 2)).toHaveLength(2);
});

test("retained event pages respect a byte budget as well as row count", () => {
  const events = Array.from({ length: 50 }, (_, index) => ({ eventId: String(index), time: "2026-01-01", content: "x".repeat(2000) }));
  const retained = mergeEventPages([], events, "desc", 4000, 10000);
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(3);
  expect(mergeEventPages([], [{ eventId: "huge", content: "x".repeat(10000) }], "desc", 4000, 100)).toHaveLength(0);
});

test("older pagination remains reachable after the retention limit is filled", () => {
  const current = [{ eventId: "new", time: "2026-01-03" }, { eventId: "middle", time: "2026-01-02" }];
  const incoming = [{ eventId: "old", time: "2026-01-01" }];
  expect(mergeEventPages(current, incoming, "desc", 2, undefined, "end").map((event) => event.eventId)).toEqual(["middle", "old"]);
});
