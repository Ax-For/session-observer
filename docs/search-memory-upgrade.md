# Search and Memory Verification

Measured locally on macOS with Node.js 22.22.2, 2026-09-12. Source logs remained
read-only. Source sizes can grow during the benchmark.

## Real Logs

176 files, approximately 1,922.9 MiB of JSONL; largest file 708.6 MiB.
The disposable dialogue cache occupied 26.9 MiB on disk. SQLite uses a 2 MiB
page cache, disables mmap, and spills temporary work to disk.

| Operation | Before | After |
| --- | ---: | ---: |
| First cache preparation and keyword query | 8.9 s direct scan | 8.8 s preparation |
| Repeated query | 9.1 s | 124 ms, including four growing files |
| Next result page | 9.5 s | 53 ms |
| No-match keyword | 9.3 s | 85 ms |
| Open matching dialogue context | Not anchored | 10 ms |
| First-page response, 25 hits | 335 KB | 36 KB |
| Previews containing the keyword | 18 / 25 | 25 / 25 |

The after run sampled a 160.9 MiB combined main/query-worker RSS peak; the before
run sampled 180.3 MiB. These are service-process measurements, not browser memory
or a universal upper bound. The datasets changed slightly between runs, so hit
count differences should not be interpreted as a controlled accuracy comparison.

## Large-File Test

`npm run test:memory` creates a physically populated 400.3 MiB JSONL file with
800 image-bearing records. It checks trailing token usage, cold/warm summaries,
latest 1,000 events, dialogue search, replay, analysis, recalculation, worker
restart, cancellation and recovery. This run peaked at 178.0 MiB for the service
and its descendants, below the 300 MiB acceptance threshold.

## Correctness and Interaction

- Complete long-text matches, including tail and chunk-boundary matches.
- Chinese substring matching, punctuation/case folding and surrogate-pair storage.
- Images and tool output excluded from the dialogue cache.
- Unchanged-file reuse, partial trailing records, incremental writes during scans,
  interrupted build resumption, rewrites, deletions and same-title session identity.
- Exact matching-session counts and cursor pagination.
- Historical-hit navigation, visible keyword focus, return to search, and dirty
  notifications that do not interrupt or automatically repeat searches.
- On-demand dialogue pages, lazy compact JSON and byte-bounded event retention;
  older pagination still advances after filling the retention window.
- Desktop Playwright coverage at 1280 and 1440 pixels, using isolated synthetic logs.

## Boundaries

No full raw-event index is held in RAM. This is a compact disk cache, not an FTS
word index: exact substring queries scan only dialogue chunks, preserving Chinese
substring semantics. The application does not silently change to token/word-only
matching. The cache is versioned and can be rebuilt without changing source logs.

The first search still reads source history once. Cancelling a query terminates
the disposable worker; committed files are reused next time. Append validation
uses file identity, size and three bounded content samples, not a cryptographic
proof that every historical byte stayed unchanged. A same-size ordinary rewrite
invalidates its file; an adversarial middle rewrite that also appends and avoids
all samples is not guaranteed to be detected. Malformed or excessively nested
records are counted as partial coverage, not silently treated as exhaustive.

Visible long messages retain one 64 Ki-character page at a time and fetch with
two-way concurrency. Event pages retain at most 4,000 rows and an estimated 8 MiB
serialized size. Raw JSON fields are compacted above 128 KiB, and raw records over
32 MiB are refused. The existing sampled 280 MiB worker guard remains protection,
not a strict instantaneous RSS ceiling.
