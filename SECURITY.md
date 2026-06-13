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
- Binding to `0.0.0.0` can expose local session data to your network.
- Raw JSONL transcripts should never be committed or attached to public issues.
- Screenshots, logs, and exports should be sanitized before sharing.
