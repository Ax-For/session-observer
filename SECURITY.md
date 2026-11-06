# Security Policy

Session Observer reads local AI coding-agent transcripts. Those transcripts may contain prompts, tool outputs, code, local paths, secrets, or other sensitive information.

## Supported Versions

Security fixes target the default branch until versioned releases are established. If you are using an older commit, please reproduce against the latest `main` before reporting when possible.

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities that may expose private transcript data, local file paths, secrets, or network access risks.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the maintainer privately before sharing exploit details.

Include:

- affected commit or version;
- operating system and Node.js version;
- whether Codex, Claude Code, or both data sources are involved;
- steps to reproduce with sanitized data;
- impact assessment and any known workaround.

## Local Exposure Notes

- The default server binds to `127.0.0.1`.
- Non-loopback binding requires `OBSERVER_ACCESS_TOKEN`. Basic authentication is not encryption: use an HTTPS reverse proxy for network access and an explicit `OBSERVER_ALLOWED_HOSTS` list.
- Host/Origin checks and a same-origin mutation header reject cross-origin writes. These are additional safeguards, not a replacement for authentication on a network.
- Cross-site top-level GET navigation may open `/` or `/index.html`, so links from other apps can launch the UI. Cross-site API requests and embeds remain blocked; host, origin and authentication checks still apply to the app shell.
- Source rename/delete is disabled unless `OBSERVER_ALLOW_SOURCE_MUTATIONS=1`; local annotations, saved views, bookmarks and prices remain writable.
- JSON request bodies are limited to 64 KiB. Background reads use one worker, an eight-job queue, a 90-second timeout and a sampled combined-memory guard.
- Git evidence executes read-only commands with hooks and filesystem monitors disabled. It reports time correlation, not authorship.
- Saved views and bookmarks include queries, short message labels and identifiers. Runtime audit/cache files and the optional SQLite dialogue cache are sensitive local data; protect backups and never publish them.
- Raw JSONL transcripts should never be committed or attached to public issues.
- Screenshots, logs, and exports should be sanitized before sharing.
