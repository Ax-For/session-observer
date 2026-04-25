# CLAUDE.md

This file gives Claude Code project-specific guidance for this repository.

## Project Overview

Session Observer is a local-first web app for inspecting Codex and Claude Code session logs. It runs a Node.js API server, serves a React/Vite frontend, and reads local JSONL transcripts directly from disk.

- Codex logs: `~/.codex/sessions/**/*.jsonl`
- Claude Code logs: `~/.claude/projects/**/*.jsonl`
- Default UI: `http://127.0.0.1:8787`

## Architecture

| Area | Files |
|------|-------|
| Node server and APIs | `server.js` |
| Process management | `manage.sh` |
| Shared parsing and aggregation | `shared/observer-core.js`, `shared/observer-data.js` |
| React app shell | `src/app.jsx`, `src/main.jsx` |
| UI surfaces | `src/components/` |
| Data hooks | `src/hooks/` |
| View models and helpers | `src/lib/` |
| Product styles | `src/styles/app.css` |
| Tests | `src/**/*.test.*`, `tests/*.test.js` |

The backend serves `dist/` when available. If the built frontend is missing, `server.js` and `manage.sh` can build it before serving.

## Commands

```bash
npm install
./manage.sh start
./manage.sh status
./manage.sh logs -f
./manage.sh stop
./manage.sh run
npm run dev
npm test
npm run test:core
npm run build
npm run check
```

Use `./manage.sh run` for foreground debugging. Use `npm run dev` for Vite-only UI iteration.

## Implementation Notes

- Keep shared Codex / Claude parsing behavior in `shared/`, not duplicated in React components.
- Keep API request wrappers in `src/api/client.js`.
- Keep long-lived page data loading in `src/hooks/`.
- Keep pure formatting, URL state, paging, and view-model logic in `src/lib/`.
- Avoid adding more state orchestration to `src/app.jsx` unless it is truly app-shell state.
- Use Mantine and Tabler Icons for product UI controls.
- Do not add remote analytics or upload session content.

## Data Model

Main event types are:

- `Prompt`
- `User`
- `Agent`
- `Tool_Call`
- `Tool_Result`
- `Token_Usage`
- `Thinking`
- `Raw`

Session titles come from Codex metadata (`state_5.sqlite`, `session_index.jsonl`) and Claude Code metadata (`~/.claude/sessions/*.json`) plus transcript title records.

## Testing Expectations

Run the smallest relevant test first, then run the broader check before finishing:

```bash
npm test
npm run test:core
npm run build
```

For parsing or aggregation changes, add or update tests under `tests/`. For UI behavior, add or update Vitest tests under `src/`.

## Security Notes

Session logs may include prompts, source code, command output, file paths, and local machine details. Do not commit raw transcripts, exported JSONL, `.runtime/`, or screenshots that expose sensitive data.
