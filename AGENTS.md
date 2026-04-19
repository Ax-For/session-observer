# Repository Guidelines

## Project Structure & Module Organization
The backend stays lean: `server.js` is the Node.js HTTP server and API layer that reads session logs, parses Codex and Claude Code events, and serves the built frontend. Shared parsing and aggregation logic lives in `shared/`. The product UI now lives under `src/`: `src/app.jsx` is the workspace shell, `src/components/` contains major surfaces like the stream and session workspaces, `src/lib/` holds view-model and formatting helpers, and `src/styles/app.css` defines design tokens and layout rules. `index.html` is the Vite entry shell, `vite.config.mjs` configures build/test behavior, and `manage.sh` handles local lifecycle commands. `.runtime/` is local-only output for PID and log files; do not treat it as source.

## Build, Test, and Development Commands
The frontend is built with Vite and served by the Node backend.

- `./manage.sh start`: start the observer in the background on `http://127.0.0.1:8787`
- `./manage.sh run`: run the server in the foreground for debugging
- `./manage.sh status`: show PID and URL
- `./manage.sh logs -f`: follow runtime logs
- `./manage.sh stop`: stop the background server
- `./manage.sh open`: open the UI in a browser
- `npm run dev`: start the Vite dev server for UI-only iteration
- `npm run build`: build the production frontend into `dist/`
- `npm test`: run the Vitest frontend tests

`manage.sh` and `node server.js` will auto-build `dist/` when it is missing. Prefer `manage.sh` for normal work.

## Coding Style & Naming Conventions
Use 2-space indentation, semicolons, and double quotes in JavaScript/JSX. Prefer React function components, `camelCase` for variables and helpers, `UPPER_SNAKE_CASE` for shared constants, and kebab-case for CSS classes. Keep UI code inside `src/` and put reusable data shaping in `src/lib/` or `shared/` instead of pushing more logic into `src/app.jsx` or `server.js`.

## Testing Guidelines
Frontend tests run with Vitest from `npm test`; backend parser checks still use `node --test tests/*.test.js`. Verify UI changes manually with `./manage.sh run` or `npm run dev`, then exercise event loading, filtering, session navigation, and drawer states on both desktop and mobile widths. If you touch parsing or aggregation logic, test with both `~/.codex/sessions` and `~/.claude/projects` data sources and record the scenarios covered in the PR.

## Commit & Pull Request Guidelines
Recent history follows short conventional prefixes such as `feat:`, `fix:`, `design:`, and `refactor:`. Keep subjects concise and imperative; Chinese and English are both already used in this repo. PRs should include a focused summary, linked issue or task if applicable, manual verification steps, and screenshots or GIFs for visible UI changes.

## Security & Configuration Tips
Session logs may contain prompts, tool output, file paths, and other local-sensitive data. Do not commit raw session files, exported JSONL, or `.runtime/` artifacts. Prefer environment variables such as `HOST`, `PORT`, `CODEX_SESSIONS_DIR`, and `CLAUDE_PROJECTS_DIR` instead of hardcoded machine-specific paths.
