# Reliability and Analysis Upgrade

Implementation checklist (desktop-first; no raw transcript publication):

- [x] Cross-file ordering, stable cursors and recoverable event references
- [x] Restart-safe SSE, watcher recovery and reading-position preservation
- [x] Bounded/cancellable background reads and aggregate process RSS budget
- [x] Archive search parity, index cleanup and detail navigation
- [x] Versioned pricing, accounting provenance and recalculation differences
- [x] Call-linked timing, turn costs and child-agent attribution
- [x] Saved views, message bookmarks and source navigation
- [x] Read-only Git evidence for session outcomes
- [x] Diagnostics, recovery actions and safe local API defaults
- [x] Component/style ownership and desktop browser CI
- [x] Full tests, desktop visual review and dense 400 MB memory validation

Acceptance: no missing interleaved events, no stale detail failures after a
restart, no mutation of source transcripts without explicit opt-in, and combined
server/background-process RSS below 300 MiB under the documented workload.

Final validation: strict lint, 108 frontend tests, 135 core tests and production
build passed. All four Playwright scenarios passed at 1280 and 1440 desktop
widths. Browser review also exercised a live session, analysis and replay detail
navigation with real local data, with no captured console errors. Regression
coverage includes immediate reload after tab changes and coalescing live
analysis revisions without clearing the existing table.

## Product Entry Points

| Surface | Available actions |
| --- | --- |
| Token / Statistics audit | Inspect parser and price versions, source coverage and recalculation differences; configure dated model rates |
| Session / Usage | Inspect per-turn tokens, estimated cost and call-ID-paired tool durations; jump to the source event |
| Session / Outcomes | Inspect parent/child agent attribution and read-only Git commit evidence |
| Event stream | Save named filters, cancel searches and retain loaded history during refresh |
| Conversation / Header bookmarks | Bookmark individual messages and reopen their source records |
| Header / Service diagnostics | Inspect combined RSS, queued tasks, listener status and failures; cancel or recover background work |

## Memory Validation

Measured on macOS with Node 22.22.2 on 2026-09-12. These are local benchmark
results, not hardware-independent latency or memory guarantees.

`npm run test:memory` creates an actual 400.3 MiB JSONL file containing 800
image-bearing records, with usage fields after the image payload. The expected
264,000 tokens must survive compaction. It samples the HTTP process and all
descendants every 100 ms and tests cancellation and worker restart recovery.

| Operation | Duration | Combined RSS after query |
| --- | --- | --- |
| Cold summary | 2.94 s | 116.6 MiB |
| Warm summary | 53 ms | 117.5 MiB |
| Latest 1,000 | 2.91 s | 142.7 MiB |
| Archive substring search | 1.42 s | 150.9 MiB |
| Replay | 1.83 s | 156.8 MiB |
| Turn analysis | 2.96 s | 170.2 MiB |
| Historical recalculation | 1.36 s | 160.8 MiB |
| Detail after worker restart | 64 ms | 117.4 MiB |
| Cancellation recovery | 65 ms | 116.7 MiB |

Peak combined RSS across the whole scenario: **172.9 MiB**.

A separate real-history check scanned 174 source files totaling approximately
1,863 MiB, including a 651 MiB file. Cold HTTP summary took 14.18 s, latest-event
read took 4.24 s, and the subsequent summary took 56 ms. It reported zero invalid
or unparsed oversized lines. After browser analysis and replay checks, the
service's combined RSS sampling peak was 222.5 MiB; idle worker shutdown reduced
it to 57.0 MiB. Raw transcripts and screenshots of real data are not included in
this repository.

Large JSON records use bounded token-stream parsing rather than buffering image
payloads. Decoder listeners are detached immediately so synchronous scans do not
retain prior decoded records until the event loop handles deferred close events.
A dedicated regression test covers this retention failure.

## Explicit Limits

The newer [search and memory verification](search-memory-upgrade.md) records the
default dialogue-cache implementation, current measurements and remaining limits.

- Turn analysis and replay describe their loaded event window, at most 1,000
  records. An initial partial turn is labelled; this is not full-history timing.
- Browser event history is bounded to 4,000 records and an 8 MiB conservative
  serialized-size estimate. Stable cursors allow loading
  older pages without relying on offsets that move when new events arrive.
- Default search streams complete dialogue into a disk cache, with 16 Ki-character
  chunks and 512-character overlap. Keywords support up to 512 UTF-16 code units;
  exact case-insensitive substring semantics also support one-character Chinese queries.
  The legacy scanner, malformed JSON and excessive nesting can have partial coverage.
  Conversation bodies are loaded on visibility, two requests at a time, with at most
  64 Ki characters retained per mounted message page. Raw JSON is lazy and compacted
  above 128 KiB. Raw-record reads above 32 MiB remain refused; dialogue body streaming
  does not allocate whole records. Image compaction does not imply lost token usage.
- Built-in prices are dated reference estimates, not verified historical bills.
  Logged costs take precedence, followed by exact local model/date/tier rates.
  Unknown models remain unpriced rather than silently receiving a zero-cost rate.
- Git commits are associated by repository and time window, not attributed to
  the agent as proven authorship. Up to 50 commits are returned by a read-only
  command with bounded time and output.
- One query worker runs at a time, with eight queued jobs, a 90-second timeout
  and a 30-second idle exit. The 280 MiB process-tree guard is sampled, not an OS
  hard limit; data beyond the tested workload may be rejected or cancelled.
- Saved views and bookmarks have 200-entry limits; audits retain ten runs and
  up to 200 changed sessions per run. Back up `.runtime/` before removing it.
- Default API access is local-only and original transcripts are read-only.
  Network binding requires an access token and should use an HTTPS reverse proxy.
