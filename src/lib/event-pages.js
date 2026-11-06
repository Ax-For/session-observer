export const EVENT_PAGE_BYTE_BUDGET = 8 * 1024 * 1024;

export function mergeEventPages(current = [], incoming = [], order = "desc", limit = 4000, byteBudget = EVENT_PAGE_BYTE_BUDGET, keep = "start") {
  const events = new Map();
  for (const event of [...current, ...incoming]) events.set(event.eventId || event.id || `${event.time}:${event.content}`, event);
  const sorted = [...events.values()].sort((left, right) => {
    const comparison = (Date.parse(left.time) || 0) - (Date.parse(right.time) || 0)
      || String(left.eventId || "").localeCompare(String(right.eventId || ""));
    return comparison * (order === "asc" ? 1 : -1);
  });
  if (keep === "end") sorted.reverse();
  let bytes = 0;
  const retained = sorted.slice(0, limit).filter((event) => {
    // Conservative UTF-16 estimate; the event pages contain compact JSON only.
    const size = JSON.stringify(event).length * 2 + 256;
    if (bytes + size > byteBudget) return false;
    bytes += size;
    return true;
  });
  return keep === "end" ? retained.reverse() : retained;
}
