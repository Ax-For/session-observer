import { apiClient } from "../api/client";

const DIALOGUE_CALL_TYPES = new Set(["agent", "prompt", "user"]);
const DETAIL_HYDRATION_CONCURRENCY = 4;

function needsDialogueHydration(event) {
  return Boolean(
    event?.eventId
    && event?.contentTruncated
    && DIALOGUE_CALL_TYPES.has(String(event.callType || "").toLowerCase()),
  );
}

export async function hydrateDialogueEvents(events = []) {
  const hydrated = [...events];
  const pendingIndexes = hydrated
    .map((event, index) => (needsDialogueHydration(event) ? index : -1))
    .filter((index) => index >= 0);
  let cursor = 0;

  async function worker() {
    while (cursor < pendingIndexes.length) {
      const index = pendingIndexes[cursor];
      cursor += 1;
      const preview = hydrated[index];
      try {
        const payload = await apiClient.fetchEventDetail(preview.eventId);
        if (!payload?.event?.content) continue;
        const fullEvent = { ...preview, ...payload.event, eventId: preview.eventId };
        delete fullEvent.contentTruncated;
        delete fullEvent.contentLength;
        hydrated[index] = fullEvent;
      } catch {
        // Keep the compact preview when the source record is no longer readable.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_HYDRATION_CONCURRENCY, pendingIndexes.length) },
    () => worker(),
  ));
  return hydrated;
}
