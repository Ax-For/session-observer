# Repository Guidelines

## Project Structure & Module Organization
This repository is intentionally flat. `server.js` is the Node.js HTTP server and API layer that reads session logs, parses Codex and Claude Code events, and serves the UI. `app.js` contains the client-side state, filtering, virtual scrolling, and session-management logic. `styles.css` holds all visual tokens and component styles, and `index.html` is the single-page shell. Use `manage.sh` for local lifecycle commands. `.runtime/` is local-only output for PID and log files; do not treat it as source.

## Build, Test, and Development Commands
There is no build step or package manifest in the tracked repo.

- `./manage.sh start`: start the observer in the background on `http://127.0.0.1:8787`
- `./manage.sh run`: run the server in the foreground for debugging
- `./manage.sh status`: show PID and URL
- `./manage.sh logs -f`: follow runtime logs
- `./manage.sh stop`: stop the background server
- `./manage.sh open`: open the UI in a browser

For direct debugging, `node server.js` is acceptable, but prefer `manage.sh` for normal work.

## Coding Style & Naming Conventions
Match the existing plain HTML/CSS/JavaScript style: 2-space indentation, semicolons, and double quotes in JavaScript. Use `camelCase` for variables and functions, `UPPER_SNAKE_CASE` for shared constants, and kebab-case for CSS classes and HTML IDs. Keep the root-file architecture unless a change clearly justifies extraction. Favor small helper functions over adding more deeply nested inline logic to `app.js` or `server.js`.

## Testing Guidelines
No automated test framework or coverage gate is configured today. Verify changes manually with `./manage.sh run`, then exercise the affected flows in the browser. At minimum, check event loading, filtering, session navigation, and any changed dialogs or batch actions. If you touch parsing or aggregation logic, test with both `~/.codex/sessions` and `~/.claude/projects` data sources and record the scenarios covered in the PR.

## Commit & Pull Request Guidelines
Recent history follows short conventional prefixes such as `feat:`, `fix:`, `design:`, and `refactor:`. Keep subjects concise and imperative; Chinese and English are both already used in this repo. PRs should include a focused summary, linked issue or task if applicable, manual verification steps, and screenshots or GIFs for visible UI changes.

## Security & Configuration Tips
Session logs may contain prompts, tool output, file paths, and other local-sensitive data. Do not commit raw session files, exported JSONL, or `.runtime/` artifacts. Prefer environment variables such as `HOST`, `PORT`, `CODEX_SESSIONS_DIR`, and `CLAUDE_PROJECTS_DIR` instead of hardcoded machine-specific paths.
