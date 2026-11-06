import { apiClient } from "../api/client";

const queue = [];
let active = 0;

function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    job.signal?.removeEventListener("abort", job.abort);
    if (job.signal?.aborted) { job.reject(new DOMException("Cancelled", "AbortError")); continue; }
    active += 1;
    apiClient.fetchDialogueBody(job.id, job.params, { signal: job.signal }).then(job.resolve, job.reject)
      .finally(() => { active -= 1; drain(); });
  }
}

export function loadDialogueBody(id, params, signal) {
  return new Promise((resolve, reject) => {
    const job = { id, params, signal, resolve, reject };
    job.abort = () => {
      const index = queue.indexOf(job);
      if (index >= 0) { queue.splice(index, 1); reject(new DOMException("Cancelled", "AbortError")); }
    };
    signal?.addEventListener("abort", job.abort, { once: true });
    queue.push(job);
    drain();
  });
}
