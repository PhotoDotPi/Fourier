# Security Policy

## Supported versions

Fourier is a self-hosted bot and ships from `main` and from tagged releases. Security fixes land on
`main` and in the next release; only the latest release is supported.

| Version          | Supported |
| ---------------- | --------- |
| Latest release   | ✅        |
| `main`           | ✅        |
| Older releases   | ❌        |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/PhotoDotPi/Fourier/security/advisories/new).
Include, where you can:

- a description of the issue and its impact,
- the version or commit you tested,
- reproduction steps or a proof of concept,
- and any suggested fix.

You can expect an acknowledgement within a few days and an assessment once the report is
triaged. Please give us a reasonable window to ship a fix before any public disclosure; we will
credit you in the advisory unless you ask us not to.

## Scope

Fourier runs as a long-lived process with a Discord token, a database URL, and a `yt-dlp`/`ffmpeg`
pipeline. In scope:

- SQL injection or cross-guild data access through the database layer,
- leaking `DISCORD_TOKEN`, `DATABASE_URL`, YouTube/Spotify credentials, or cookie files,
- remote code execution or command injection via `yt-dlp`/`ffmpeg` arguments or user input,
- server-side request forgery through URL handling,
- privilege escalation through Discord permissions or the invite URL,
- dependency vulnerabilities reachable from Fourier's code.

Out of scope:

- vulnerabilities in `yt-dlp`, `ffmpeg`, `discord.js`, `Bun`, or Neon themselves — report those
  upstream,
- anything that requires an already-compromised host or a modified build,
- denial of service from an operator deliberately misconfiguring their own instance.

## Hardening notes for operators

- Treat `.env`, `YT_DLP_COOKIES_PATH`, and the audio cache as secrets; they can contain credentials
  and personal listening data.
- Keep `yt-dlp` and `ffmpeg` current — `YT_DLP_AUTO_UPDATE=true` refreshes `yt-dlp` at startup.
- Use a direct, non-pooled database URL and restrict network access to the database.
