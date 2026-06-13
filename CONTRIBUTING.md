# Contributing to Session Observer

Thanks for taking the time to improve Session Observer. This project is a local-first observability tool, so contributions should preserve privacy, predictable local behavior, and low memory usage.

## Development Setup

```bash
npm install
./manage.sh start
./manage.sh open
```

For frontend-only iteration:

```bash
npm run dev
```

## Useful Commands

```bash
npm run lint
npm test
npm run test:core
npm run build
npm run check
```

Run `npm run check` before opening a pull request when you touch parsing, aggregation, API behavior, or visible UI.

## Contribution Guidelines

- Keep raw Codex / Claude Code JSONL transcripts out of commits.
- Use sanitized screenshots and example data in documentation, issues, and pull requests.
- Keep the backend memory-conscious: avoid retaining full historical event arrays unless there is a clear bounded lifetime.
- Prefer shared parsing and aggregation helpers in `shared/` over duplicating event logic in UI code.
- Keep UI changes product-focused: clear hierarchy, dense but readable information, and deliberate empty/loading/error states.
- Include focused tests for changes to parsers, filters, summaries, session grouping, token accounting, or user-visible workflows.

## Pull Request Checklist

- [ ] The change is scoped to one problem or feature.
- [ ] Tests were added or updated when behavior changed.
- [ ] `npm run check` was run locally, or the PR explains why it could not be run.
- [ ] Screenshots or GIFs are attached for visible UI changes.
- [ ] No raw session logs, local secrets, or unsanitized prompts are included.

## Reporting Bugs

When reporting a bug, include:

- operating system and Node.js version;
- whether the source is Codex, Claude Code, or both;
- reproduction steps using sanitized data;
- relevant logs from `./manage.sh logs`;
- screenshots with sensitive content redacted.
