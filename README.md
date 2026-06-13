# Session Observer

[![CI](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-LTS%20or%20newer-339933.svg)](package.json)
[![React](https://img.shields.io/badge/react-19-149eca.svg)](package.json)

Local-first observability dashboard for Codex and Claude Code sessions: event stream search, conversation replay, token usage, workspace insights, and memory-safe JSONL scanning.

[中文文档](README.zh-CN.md)

![Session Observer overview](docs/screenshots/overview.png)

## Why Session Observer?

AI coding sessions quickly become hard to inspect: prompts, agent messages, tool calls, token usage, working directories, and long JSONL histories are scattered across local files. Session Observer turns those local logs into a desktop-friendly observability workspace without uploading your session content anywhere.

Use it when you want to:

- inspect recent Codex and Claude Code activity in one timeline;
- jump from an event to the related session and conversation detail;
- understand token usage, cache hits, reasoning output, and high-cost sessions;
- see workspace-level activity and daily session heat;
- monitor process memory while scanning large local JSONL histories.

## Highlights

- **Local-first by default**: binds to `127.0.0.1` and reads local Codex / Claude Code transcripts directly.
- **On-demand event stream**: recent events are read as needed, with explicit search submission, loading state, filters, and dialogue-only highlighting.
- **Conversation-aware sessions**: browse active sessions, workspace trees, session details, conversation drawers, models, tools, and related events.
- **Detailed token ledger**: separates uncached input, cache hits, cache creation, output, and reasoning output across time, model, workspace, and session views.
- **Memory-aware architecture**: avoids keeping full historical JSONL data resident in memory; dashboard surfaces RSS, heap, external memory, and source-cache state.
- **Privacy-conscious docs and exports**: screenshots and examples are sanitized; raw session files are intentionally excluded from source control.

## Screenshots

Screenshots are generated from sanitized example data. They do not contain real prompts, local paths, tool outputs, or raw session JSONL content.

| Overview | Event stream |
| --- | --- |
| ![Overview dashboard](docs/screenshots/overview.png) | ![Event stream](docs/screenshots/stream.png) |

| Token ledger | Session detail |
| --- | --- |
| ![Token dashboard](docs/screenshots/tokens.png) | ![Session detail](docs/screenshots/sessions.png) |

## Quick Start

```bash
npm install
./manage.sh start
./manage.sh open
```

The default UI is `http://127.0.0.1:8787`.

`manage.sh` automatically builds the Vite frontend when `dist/` is missing or stale. For UI-only iteration, run:

```bash
npm run dev
```

## Data Sources

| Source | Default path | Purpose |
| --- | --- | --- |
| Codex sessions | `~/.codex/sessions/**/*.jsonl` | Codex events, prompts, agent messages, tool calls, and token usage |
| Claude Code projects | `~/.claude/projects/**/*.jsonl` | Claude Code project sessions, tool calls, messages, and usage |
| Codex state DB | `~/.codex/state_5.sqlite` | Codex title metadata, read through the `sqlite3` CLI |

## Requirements

- Node.js LTS or newer
- npm
- `sqlite3` CLI for Codex title metadata
- A modern desktop browser

## Common Commands

```bash
./manage.sh start      # Start the local observer in the background
./manage.sh status     # Show PID and local URL
./manage.sh logs -f    # Follow runtime logs
./manage.sh stop       # Stop the background service
./manage.sh run        # Run the server in the foreground

npm test               # Run frontend Vitest tests
npm run test:core      # Run parser and aggregation tests
npm run build          # Build the frontend
npm run check          # Run lint, tests, core tests, and production build
```

## Feature Map

| Surface | What it shows |
| --- | --- |
| Overview | Runtime status, session heatmap, token trend, source health, memory usage, workspace concentration, and active sessions |
| Token | Token ledger, cache hits, cache creation, output, reasoning output, time windows, model cost, workspace spend, and high-cost sessions |
| Insights | Active rate, session load, tool reliability, workspace load, activity shape, and operational notes |
| Event stream | Observe/raw modes, button-triggered search, loading state, filters, highlighted dialogue results, recent active sessions, and session jumps |
| Sessions | Grouped session list, workspace tree, active sessions, detail panel, conversation replay, focused stream navigation, and batch operations |

## Architecture

```text
server.js              Node HTTP API, static frontend, and session-management routes
manage.sh              Local service lifecycle helper
shared/                Codex / Claude Code parsing, dedupe, token, trace, and aggregation logic
server/                Source scanning, on-demand event reading, summary cache, and HTTP routes
src/app.jsx            React workspace shell, URL state, and page orchestration
src/components/        Overview, stream, sessions, event drawer, and conversation drawer
src/hooks/             Data loading, source change stream, session actions, and URL sync
src/lib/               View models, formatting, paging, event display, and URL helpers
tests/                 Node-side parser, cache, memory, route, export, and trace tests
```

The backend stays a single local Node process. The frontend is built with Vite and served by the same process. Shared parsing lives in `shared/` so server-side summaries and frontend view models use the same event vocabulary.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `8787` | HTTP port |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex session directory |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code projects directory |
| `CODEX_STATE_DB` | `~/.codex/state_5.sqlite` | Codex title metadata SQLite database |

Example:

```bash
PORT=8790 CODEX_SESSIONS_DIR=/path/to/codex/sessions ./manage.sh start
```

## Privacy Model

Session logs may contain prompts, tool output, local paths, code snippets, and other sensitive data. Session Observer is designed for local inspection:

- the default server binds to `127.0.0.1`;
- raw JSONL transcripts and `.runtime/` artifacts are ignored by source control;
- screenshots and documentation examples should use sanitized data;
- binding to `0.0.0.0` should be done only when you understand the network exposure.

```bash
HOST=0.0.0.0 ./manage.sh start
```

## Project Health

- License: [MIT](LICENSE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Social preview asset: [docs/social-preview.png](docs/social-preview.png)

## Roadmap

- More local coding-agent adapters.
- Session diff and timeline comparison.
- Sanitized report exports for sharing incidents.
- Pluggable cost models and model aliases.
- Better long-running source cache diagnostics.
