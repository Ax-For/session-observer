# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dual-platform session observer — a lightweight vanilla JS web app for observing both Codex (`~/.codex/sessions/**/*.jsonl`) and Claude Code (`~/.claude/projects/**/*.jsonl`) session logs. Features real-time event stream, statistics dashboard, session management, batch operations, and keyboard shortcuts. No build system, no dependencies, no framework. Pure HTML/CSS/JS + Node.js HTTP server.

## File Structure

| File | Purpose |
|------|---------|
| `server.js` | Node.js HTTP server — serves static assets, provides `/api/events` and session management endpoints, reads JSONL from both directories |
| `app.js` | Frontend SPA — state management, filtering, virtual scrolling, dashboard rendering, batch operations, keyboard navigation |
| `styles.css` | All CSS — light/dark themes, cozy/compact density, dashboard styles, batch operation UI, platform-specific chip colors |
| `index.html` | Entry point — dual-platform brand header, filters, statistics dashboard, quick filters, session sidebar, event stream, multiple modals |
| `manage.sh` | Process management script — start/stop/restart/status/logs/open/run |

## Key Commands

```bash
# Start server in background
./manage.sh start

# View server status
./manage.sh status

# Follow server logs
./manage.sh logs -f

# Open UI in browser
./manage.sh open

# Stop server
./manage.sh stop

# Run in foreground (for debugging)
./manage.sh run
```

Default: `http://127.0.0.1:8787`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | HTTP port |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex JSONL session files |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code JSONL session files |

## Architecture

### Server (`server.js`)

- Plain Node.js `http` server (no framework)
- Serves static files: `index.html`, `app.js`, `styles.css`
- API endpoints:
  - `GET /api/events` — paginated, filterable events
  - `GET /api/sessions` — session list for management view
  - `POST /api/sessions/rename` — rename session title
  - `POST /api/sessions/delete` — delete single session
  - `POST /api/sessions/batch-delete` — batch delete sessions
- **Dual parser architecture**: `parseCodexLineToEvent()` and `parseClaudeCodeLineToEvent()`
- `resolveParserForFile(filePath)` selects parser by file path
- `computeAggregate()` reads from both directories, aggregates token usage
- File watchers on both directories for auto-refresh (3-second warmup interval)
- Token usage extracted from both Codex `token_count` events and Claude Code `assistant.usage` field

### Frontend (`app.js`)

- **Two main views**: Event Stream (default) and Session Management (tab switch)
- **Statistics Dashboard**: Token usage summary, event type distribution (bar charts), model distribution, platform distribution, count stats
- **Session Management**: Rename/delete sessions, batch select, batch delete/export
- **Virtual scrolling**: Both session sidebar and event stream for performance
- **Keyboard shortcuts**: Navigation (j/k), refresh (r), search focus (f or /), theme toggle (t), mode toggle (m)
- **Quick filters**: All events, alerts only, high token threshold
- **Import/Export**: JSONL file import (auto-detect platform), filtered events export

### Event Types

| Type | Codex Source | Claude Code Source |
|------|-------------|-------------------|
| `Prompt` | `role=user` message | — |
| `User` | — | `type=user` (non-meta, non-tool-result) |
| `Agent` | `role=assistant` / `agent_message` | `type=assistant` with text |
| `Tool_Call` | `function_call` | `tool_use` content block |
| `Tool_Result` | `function_call_output` | `type=user` with `toolUseResult` |
| `Token_Usage` | `token_count` payload | `assistant.message.usage` field |
| `Thinking` | — | `thinking` content block (hidden in observe mode) |
| `Raw` | Unknown types, meta, attachments | Meta commands, permissions, snapshots, empty responses |

### Dashboard Metrics

- **Token Usage**: Input/output/total/cached/reasoning tokens — aggregated from all `Token_Usage` events in selected sessions
- **Event Type Distribution**: Bar chart showing counts per event type
- **Model Distribution**: Count of sessions using each model (server mode) or event counts (local mode)
- **Platform Distribution**: Codex vs Claude Code session counts
- All metrics have tooltip explanations (`data-tip` attributes) explaining calculation methods

## UI Views

### Event Stream View (default)
- Left: Session sidebar with grouping and quick selection
- Center: Filterable event stream with virtual scroll
- Top: Statistics dashboard with visual charts
- Quick filters bar below dashboard

### Session Management View
- Toolbar: Search, platform filter, named-only filter, batch actions
- Session cards with checkboxes for batch selection
- Per-session actions: Detail, Rename, Delete
- Batch delete with confirmation modal
- Batch export to JSONL

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `f` or `/` | Focus search input |
| `r` | Manual refresh |
| `a` | Toggle auto-refresh (5s) |
| `t` | Toggle dark/light theme |
| `m` | Toggle observe/raw mode |
| `j` or `↓` | Next event in stream |
| `k` or `↑` | Previous event in stream |
| `Enter` | Open selected event detail |
| `gg` | Jump to first event |
| `G` | Jump to last event |
| `Esc` | Close modal |

## Development Notes

- **No build step** — edit files directly, refresh browser (or use auto-refresh)
- **No package.json** — no `npm install`, no linting, no test framework
- **No TypeScript** — plain JavaScript
- **Virtual scrolling** — handles thousands of events efficiently
- **Server warmup** — auto-rebuilds index every 3 seconds when dirty
- **Claude Code subagents** are merged into main session stream, marked with `agent=` prefix
- **Session titles**: Codex reads from SQLite `threads` table, Claude Code reads from `~/.claude/sessions/*.json`
- **Tooltip system**: All dashboard metrics use `.has-tip` with `data-tip` for user guidance

## Similar Projects

- [obsessiondb/rudel](https://github.com/obsessiondb/rudel) — Cloud-based Claude Code & Codex analytics (249 stars)
- [KyleAMathews/claude-code-ui](https://github.com/KyleAMathews/claude-code-ui) — Durable Streams real-time UI (397 stars)
- [eric-gitta-moore/codex-session-viewer](https://github.com/eric-gitta-moore/codex-session-viewer) — Local Codex viewer (Vue)

**Unique advantages of this project**:
- 100% local, no cloud dependency
- Zero npm dependencies
- Dual-platform in single lightweight app
- Privacy-friendly (no data upload)