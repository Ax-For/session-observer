# Session Observer

**A local-first observability workbench for Codex and Claude Code.** Turn scattered JSONL transcripts into a semantic activity stream, searchable session library, token and cost ledger, and runtime health dashboard - without uploading prompts, tool output, or source paths.

[![CI](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-LTS%20or%20newer-339933.svg)](package.json)
[![React](https://img.shields.io/badge/react-19-149eca.svg)](package.json)
[![Local first](https://img.shields.io/badge/data-local--first-16a085.svg)](#privacy-model)

[中文文档](README.zh-CN.md)

![Session Observer overview](docs/screenshots/overview.png)

Session Observer is built for developers who use multiple local coding agents and need to answer practical questions quickly:

- What is running right now, and which session is still writing?
- What did the user ask, what did the agent answer, and which tools ran in between?
- Where did input, cache-read, cache-write, output, reasoning, and estimated cost come from?
- Which models, workspaces, files, and commands dominate usage?
- Can a large transcript history be inspected without building a memory-heavy global event index?

## Start in 30 seconds

```bash
npm install
./manage.sh start
./manage.sh open
```

The default UI is [http://127.0.0.1:8787](http://127.0.0.1:8787). No account or external database is required.

`manage.sh` builds the Vite frontend when needed and runs the Node service with a constrained heap. For UI-only development, use `npm run dev`.

## Product surfaces

| Surface | What it is for |
| --- | --- |
| **Overview** | Runtime and source health, RSS and heap usage, today's sessions and conversations, 24-hour event and token load, active writers, usage cadence, and workspace concentration |
| **Token ledger** | Uncached input, cache hits, cache creation, output, reasoning output, estimated cost, efficiency ratios, forecasts, trends, model attribution, workspace attribution, and high-cost sessions |
| **Event stream** | Semantic activity grouped by user turn, dedicated Q&A/tool/usage/raw views, explicit search, filters, highlighted dialogue matches, live follow/pause, and direct jumps into session detail |
| **Session library** | Active sessions, workspace grouping, directory tree, stable full-session totals, start and latest timestamps, collapsible conversations, activity, usage, files/tools, commands, errors, compactions, and raw diagnostics |

## Why it is different

### Semantic activity instead of raw log noise

The default event stream groups a user turn, its agent response, tool calls, token snapshots, model, duration, and errors into one expandable activity. The raw view remains available for debugging, but internal records no longer overwhelm the normal workflow.

Search is submitted explicitly and matches only user and agent dialogue content. It does not produce noisy hits from internal metadata, paths, or token records.

### One canonical session workbench

Every event-to-session jump opens the same detail surface. Full-session counts and token totals come from the stable summary, while conversation content is read from a bounded recent window. The latest 400 raw events load first, turns are collapsible, and older content is fetched only when requested.

### Detailed token and cost attribution

Token accounting separates:

- uncached input;
- cache-read input;
- cache creation;
- model output;
- reasoning output.

The UI attributes usage by time window, model, platform, workspace, and session. Cost values are estimates based on the recognized model price table; they are not provider invoices.

### Designed for large local histories

Session Observer avoids retaining the complete transcript corpus in memory:

- recent event pages are reverse-scanned directly from source files;
- completed archive summaries are reused when files do not change;
- growing current files are parsed incrementally;
- persistent summaries keep bounded goals, outcomes, tools, files, errors, compactions, and model transitions instead of raw event arrays;
- the UI virtualizes or batches large lists and exposes process RSS, heap, external memory, and cache state.

This keeps normal navigation responsive even when individual JSONL files are hundreds of megabytes. Actual memory usage still depends on transcript shape, active filters, and the number of pages explicitly loaded.

## Screenshots

Screenshots use sanitized example data. They do not contain real prompts, local user paths, tool output, credentials, or source JSONL records.

| Overview | Event stream |
| --- | --- |
| ![Overview dashboard](docs/screenshots/overview.png) | ![Event stream](docs/screenshots/stream.png) |

| Token ledger | Session workbench |
| --- | --- |
| ![Token dashboard](docs/screenshots/tokens.png) | ![Session detail](docs/screenshots/sessions.png) |

## Data sources

| Source | Default path | Data used |
| --- | --- | --- |
| Codex sessions | `~/.codex/sessions/**/*.jsonl` | Prompts, agent messages, tool calls, token usage, models, timestamps, and working directories |
| Claude Code projects | `~/.claude/projects/**/*.jsonl` | Project sessions, messages, tool activity, models, and usage |
| Codex state DB | `~/.codex/state_5.sqlite` | Session title metadata, read through the `sqlite3` CLI |

Source changes are observed through filesystem notifications and streamed to the browser. Event pages and searches are still read on demand rather than held in a permanent in-memory index.

## Requirements

- Node.js LTS or newer
- npm
- `sqlite3` CLI for Codex title metadata
- A modern desktop browser

## Commands

```bash
./manage.sh start      # Start the observer in the background
./manage.sh status     # Show PID and local URL
./manage.sh logs -f    # Follow runtime logs
./manage.sh stop       # Stop the service
./manage.sh run        # Run in the foreground

npm test               # Frontend Vitest suite
npm run test:core      # Parser, aggregation, cache, and route tests
npm run build          # Production frontend build
npm run check          # Lint, all tests, and production build
```

## Architecture

```text
server.js              Local HTTP API and built frontend
manage.sh              Service lifecycle and memory-oriented Node flags
server/                On-demand scanning, source watchers, summary cache, and routes
shared/                Codex / Claude Code parsing, dedupe, token, trace, and aggregation logic
src/app.jsx            React shell, URL state, and workspace orchestration
src/components/        Overview, token, event stream, session library, and detail surfaces
src/hooks/             Data loading, source changes, paging, and session actions
src/lib/               Activity models, view models, formatting, paging, and URL helpers
tests/                 Node-side parser, cache, memory, route, and trace tests
```

The backend remains one local Node process. Vite builds the React interface, which is served by the same process. Shared parsing keeps server summaries and frontend views on the same event vocabulary.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `8787` | HTTP port |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex transcript directory |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code project directory |
| `CODEX_STATE_DB` | `~/.codex/state_5.sqlite` | Codex title metadata database |

```bash
PORT=8790 CODEX_SESSIONS_DIR=/path/to/codex/sessions ./manage.sh start
```

## Privacy model

Session transcripts may contain prompts, source code, tool output, filesystem paths, and credentials. Session Observer is designed for local inspection:

- the default server binds only to `127.0.0.1`;
- transcript JSONL files and `.runtime/` artifacts are excluded from source control;
- searches and dashboards run against local files;
- no telemetry or hosted storage is required.

Only bind to a non-local interface when you understand the exposure risk:

```bash
HOST=0.0.0.0 ./manage.sh start
```

## Project

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [MIT license](LICENSE)
- [Social preview](docs/social-preview.png)

## Roadmap

- Additional local coding-agent adapters.
- Session comparison and timeline diffing.
- More configurable pricing aliases and retention controls.
- Deeper diagnostics for long-running source watchers and cache reuse.
