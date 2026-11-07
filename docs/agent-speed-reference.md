# Agent Speed reference and integration

## Reference

The local reference checkout is `agent-speed` at commit
`384ce020cc655133e95aaad5cc085f3985f0ed99` (MIT). This integration is an independent
JavaScript implementation informed by its
[measurement specification](https://github.com/zoefix/agent-speed/blob/384ce020cc655133e95aaad5cc085f3985f0ed99/spec/METRICS.md),
especially response boundaries, finalized Claude snapshots, duplicate usage,
and the distinction between observed and estimated speed.

## Scope decisions

| Capability | Decision |
| --- | --- |
| Per-response output speed and first-content waiting | Added to Session → Usage, with coverage counts and source-record navigation |
| Tool duration and parent/child attribution | Reuse existing call-ID timing and exclusive source-log attribution |
| Three-second live throughput and in-flight prediction | Added to Overview: per-platform and per-session output, generating/tools/idle phases, separate measured/estimated values |
| Five-minute live history | Added: 300 one-second buckets, recomputed from response intervals so completed usage replaces predictions |
| Composite performance score against a 14-day model baseline | Added to Overview: current score, same-source/model baseline, relative change, seven component measures, model selector and daily trend |
| Several folders per source and compressed Codex archives | Native directory lists plus Codex archive discovery for history and baselines |
| Retained daily usage, model speed and modes | Token → 每日历史: calendar filters, score trends and daily usage / execution-mode CSVs |
| Floating orb, network traffic and remote reporting | Outside this local session workspace's current scope |

## Measurement contract

- The Session → Usage analysis uses the existing window of at most 1,000 events,
  showing 20 responses, expandable to 100. Overview uses the separate bounded
  live monitor described below. Neither feature reports data remotely or queries
  provider quotas automatically.
- Output speed is the sum of valid finalized output tokens divided by the sum
  of their response intervals. It includes the initial wait. It is not an
  arithmetic average of individual rates or lifetime tokens divided by session age.
- Request starts come from input/tool-result boundaries, or Claude's explicit
  `api-request` record when available. The end is the usage/final snapshot time.
  Logging delays and coarse boundaries can affect this estimate; it is not
  provider-side generation speed. Tool waits preceding a new tool-result start
  are excluded from that new response; tool durations remain separately reported.
- The first-content median uses the first observed content record, including
  reasoning and tool-call output. This is local log timing, not server TTFT.
- Modern Codex response IDs deduplicate usage. After modern usage is encountered,
  legacy usage for that file is ignored; earlier legacy responses remain available.
  Legacy cumulative usage detects duplicates and supplies output deltas; decreases
  fall back to the reported response usage.
- Claude records sharing a message ID merge into one response. A missing
  `stop_reason` is unfinished and has no speed. Repeated finalized snapshots do
  not extend the interval. Synthetic model messages are excluded.
- Missing starts/usage and intervals over 15 minutes are unmeasured. Valid
  intervals under 500 ms use a 500 ms floor, marked in the detail table. Zero
  output with valid boundaries is a real zero, distinct from unavailable data.
- Codex inherited history is excluded using the first session timestamp and,
  when safely representable, `subagent_history_start_ordinal`. This change adds
  performance metadata only; it does not recalculate the existing token ledger.
- A truncated window can miss the first request start or earlier finalization
  evidence. Coverage refers to identified responses in that window, not complete
  session history. File writes are assumed to preserve causal order; copied
  Claude history without reliable identity and malformed timestamps remain limits.

## Data and memory boundaries

Only small timing/usage signals accompany indexed events: kind, bounded response
ID, usage numbers and booleans. No additional transcript text is retained.
The existing query worker computes the analysis; maps are bounded by the loaded
window. Existing event-retention and worker memory guards remain in effect.

## Live monitor

- `server/live-speed-engine.js` maintains only timing, usage and bounded session
  labels. The HTTP process owns this state; disposable query workers do not.
- `server/live-speed-monitor.js` reuses source-watcher discovery and file-change
  notifications. A serialized one-second tick reads only appended bytes. Existing
  30-second discovery reconciles missed watcher notifications.
- Track at most 64 recently written Codex/Claude JSONL files; seed each from its
  last 1 MiB and read its first metadata line. Each tick reads at most 2 MiB in
  256 KiB chunks. Partial records are buffered up to 128 KiB; larger/malformed
  records are skipped and disclosed in the UI. Rotation and truncation reset the
  tail context. No raw completed transcript is retained.
- Keep at most 128 agents and 4,096 response records for 30 minutes. UI scope is
  all local monitored sessions, independent of historical date/platform filters.
  This bounded tail can miss request starts and is not full-history accounting.
- Live output is the measured-plus-estimated overlap with the last three seconds,
  divided by three. A measured interval requires finalized usage and a request
  boundary; durations use the same 500 ms floor and 15 minute upper bound.
- A generating request uses the weighted speed of its last three measured
  responses within ten minutes, then up to ten same-model/same-platform responses
  within thirty minutes. Without a sample or start boundary, show unknown.
  Unfinished Claude intervals and the subsequent in-flight interval are disjoint.
- The chart uses one-second buckets for the last five minutes; its peak is a
  five-minute bucket peak, not a daily or lifetime peak. Estimates are recomputed
  and replaced when final usage arrives. A missing final response can therefore
  leave a gap after its phase ends; we do not persist an estimate as measured data.
- Session phase becomes idle after five minutes without recognized activity.
  Parent and child rows contribute only their own responses, never inclusive
  subtree totals. The first Codex metadata record wins over copied parent metadata.
- `/api/live-speed` pushes SSE snapshots; `/api/live-speed/snapshot` provides a
  diagnostic snapshot. Both inherit the existing host/origin/access-token policy.
  No client-supplied file path is accepted. Cap streams at eight and disconnect
  consumers with over 256 KiB queued. The browser closes streams while hidden,
  reconnects when visible, and suppresses current numbers on connection loss.

## Live integration verification

- Deterministic tests cover window overlap, estimate replacement, platform/agent
  sums, Claude finalization, duplicate usage, inherited metadata/history, stale
  phases, partial appends, oversized rows, file rotation and slow SSE consumers.
- Browser E2E appends real Codex and Claude fixtures while the page stays open,
  then verifies generating → tools → idle, historical chart rendering, idle-row
  visibility, session navigation, light/dark appearance and desktop overflow.
- Actual local Codex logs populate the live surface. Inactive Claude sessions
  correctly show zero current rate; the live Claude transition is fixture-tested.
- Final strict lint, 146 frontend tests, 169 core tests and production build passed.
  The existing 24 desktop E2E cases passed; both new live-flow cases passed again
  after the final interval/metadata corrections. Manual 1280/1440 light/dark
  review reported no browser errors or horizontal overflow.
- Re-running the 400.3 MiB log harness with the live monitor enabled observed
  **177.3 MiB** peak combined server/descendant RSS (browser excluded). This is a
  local workload measurement, not a universal upper bound.

## Composite score and 14-day baseline

The implementation follows agent-speed METRICS 6.9 and 6.11. Its 1000-point
reference is a fixed personal calibration, not an industry benchmark or a score
of answer quality. It is independent of the user's historical baseline.

- Per agent, use the newest 20 finalized, timed responses ending within 30 minutes.
  At least three are required; three through nine are provisional. Ties sort by
  response key. Idle scores remain available and are labeled as idle.
- Components and original weights: output throughput 30%, first-content median
  latency 20%, completed tools per active minute 15%, reasoning throughput 10%,
  input cache hit rate 10%, geometric mean tool time 10%, tool success 5%.
  Reference values are 50 tok/s, 5000 ms, 3 tools/min, 20 reasoning tok/s, 95%,
  400 ms and 95%. Throughput's ratio has a 0.01 floor and no ceiling; other ratios
  are clamped to 0.05–20. Missing components are omitted, with weights normalized
  over present components in the weighted geometric mean.
- First-content latency uses the original request start, while throughput and
  active intervals use the 500 ms duration floor. Tool time has a 50 ms floor;
  intervals over 15 minutes do not count. Unknown tool outcomes are not failures.
  Live tool storage is the last 64 calls per agent; active time is the exact union
  of the sampled response and eligible tool intervals.
- Overview selects the highest scored non-idle agent, otherwise the highest idle
  score. It never adds scores across agents. A selector exposes each agent's own
  score and seven component measures/sample counts.
- Baselines pool the same platform and raw model over `[today − 14, today − 1]`
  using the server's local calendar/timezone. Today is excluded. At least 20 valid
  responses are required. Daily trend values also need 20 responses; smaller days
  are gaps. The 14-day result pools sufficient statistics rather than averaging
  daily scores. Historical latency uses 64 logarithmic bins and historical active
  time uses the upstream completion-order online union rule.
- The query worker scans complete files with bounded JSONL buffers, using the
  existing streaming JSON compactor for large image/tool records. Temporary SQLite
  tables hold compact timing/usage facts while a file is analyzed, so large files
  do not require an in-memory response array. Repeated Claude snapshots merge;
  inherited Codex metadata/history is excluded. Cross-file response ownership is
  retained as SHA-256 digests to avoid counting copied histories again.
- The initial 14-day implementation kept only daily numeric aggregates, model names, hashed file fingerprints and hashed
  response ownership survive in `.runtime/performance-history.sqlite` (mode 0600).
  No prompts, commands, tool output or raw response IDs are stored. The temporary
  response/tool facts are dropped after each refresh. Hash claims and day records
  expired outside the baseline window. The extended history below keeps the new aggregates beyond that window.
- File transactions replace changed contributions; unchanged files reuse cached
  aggregates. Fingerprints include inode and ctime as well as size/mtime. Parser
  version/timezone changes rebuild existing files. Scans run at startup, every ten
  minutes, on the first minute tick after midnight, and via **更新基线**. A cancelled
  worker preserves completed-file transactions for a retry. Scan errors, skipped
  records and incomplete final lines are disclosed; fewer samples never become a
  fabricated zero or baseline.
- `/api/performance-baseline` returns the cache; the protected POST
  `/api/performance-baseline/refresh` schedules an update. Both use the existing
  HTTP policy. Live SSE carries the baseline revision and per-agent comparison,
  while the full model history is fetched only when that revision/status changes.

Parity fixtures in `tests/fixtures/performance-score-reference.json` are a subset
of agent-speed's MIT-licensed fixtures at the pinned commit. Its license is kept
beside the fixture. Tests compare unrounded values at 1e-9 relative tolerance,
including all seven components, floors/clamps, pooled medians, local-day window
selection and completion-order daily records. Parser-to-history tests cover both
platforms, copying/deduplication, cache replacement/reuse, midnight rollover,
oversized records and persistence without transcript content.

Final score integration checks on 2026-11-07: strict lint, **149 frontend tests**,
**188 core tests**, production build and **30 desktop E2E cases** passed. Both
score E2E cases were rerun after the final copied-history/cache changes. Manual
1280/1440 light/dark review covered component details and model switching with no
browser errors or horizontal overflow. The 400.3 MiB harness now explicitly waits
for the baseline scan and checks all 800 oversized records were parsed without
inventing a score for unfinished responses; peak combined server/descendant RSS
was **172.9 MiB** in that run (browser excluded).

## Native locations and retained daily history

The next integration follows [Agent Speed v1.6.2](https://github.com/zoefix/agent-speed/releases/tag/v1.6.2), especially [location lists and daily history](https://github.com/zoefix/agent-speed/blob/v1.6.2/spec/METRICS.md) and [execution-mode evidence](https://github.com/zoefix/agent-speed/blob/v1.6.2/spec/EXECUTION-MODES.md).

- The local location manifest is shared by the session index, query worker and live monitor. Overlapping roots, resolved root aliases and hard links are read once. The history scan also discovers Codex `archived_sessions` beside configured `sessions` roots and reads `.jsonl.zst` without writing an uncompressed copy. Its frame reader supports concatenated and skippable frames; decoder windows are capped at 16 MiB. Corrupt archives leave the last successful contribution intact and are surfaced as failed files.
- The existing background scan now maintains daily contributions for every readable date. Response IDs (or stable fallback identities for legacy records) and tool-call identities are hashed for deduplication across copies and moves. Input includes cache reads and writes; output includes reported reasoning. Mean output speed pools measured output and duration; unmeasured and unfinished responses are disclosed and do not produce a made-up speed. Price estimates follow the local pricebook and log-provided message costs. Missing sources retain their last calculated daily contribution.
- The scan commits each file and yields to interactive queries between batches. Its progress is shown while initial backfill runs. If the worker stops, the next scan reuses completed files and retries the incomplete ones.
- The 14-day score baseline still excludes today and requires 20 measured responses. Previous-version baseline aggregates from unavailable logs remain usable inside that window when their replacements have not been read. They do not invent a full usage row. The daily history is paginated; date filters and both CSV exports use the same aggregate rows. Model cells are escaped for spreadsheets.
- Codex request and turn facts and Claude's explicit response speed and effort are collected when logged. The live list labels configuration, selections, recorded facts and served values. Configured-only values never enter daily mode counts. Missing facts are grouped as unknown. Daily performance scores still compare the same source and model across modes.

Verified on 2026-11-07: strict lint, 152 frontend tests, 198 core tests and production build passed. All 32 desktop browser cases passed, including archive discovery, alternate Claude roots, CSV scope, source removal, model scores and mode evidence. Real-data browser review at 1280/1440 in light/dark checked pagination, speed charts, aligned controls and overflow. The service completed all 279 source files, including 236 compressed Codex files, with zero failed/skipped records; available history reached 2026-03-23. The 400.3 MiB regression workload, now including daily-history assertions, peaked at 168 MiB combined server/descendant RSS (browser excluded). The existing 1180 px desktop shell still overflows at 390 px.

## Earlier response-analysis verification on 2026-11-07

- Strict lint, 141 frontend tests, 162 core tests and the production build passed.
  All 24 desktop E2E cases passed; the four analysis/audit workflow cases were
  rerun successfully after the final legacy-usage correction.
- Parser-to-index-to-analysis tests cover modern/legacy migration, duplicate
  records, cumulative output deltas, Claude finalization, tool boundaries,
  inherited history, missing starts, aborts and the 500 ms floor.
- Component tests cover unavailable metrics, sample counts and source navigation.
- Desktop E2E exercises the performance section and opening its original record.
- Real Codex and Claude Code logs both produced measured responses; the browser
  verified source navigation, 1280/1440 widths and light/dark presentation.
- The 400.3 MiB synthetic log run passed summary, search, replay, analysis,
  recalculation, restart and cancellation checks. Highest observed combined
  server/descendant RSS was **175.5 MiB**; browser memory is excluded. The harness
  now includes endpoint diagnostic readings when computing its peak, and verifies
  that response signals survive large-record compaction.

These are local measurements, not universal memory or timing guarantees.

The existing shell still enforces a 1,180 px minimum width. A 390 px smoke check
confirmed horizontal overflow; mobile layout is not accepted by this desktop
release and needs a separate shell/layout pass.
