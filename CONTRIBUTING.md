# Contributing to Fourier

Thanks for taking the time to contribute. This guide covers the practical steps; the
[README](README.md) covers what Fourier is and how to run it.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Bug reports** — open a [support request](.github/ISSUE_TEMPLATE/support-request.yml) with logs
  from a run with `DEBUG=*` set.
- **Feature requests** — open a [feature request](.github/ISSUE_TEMPLATE/feature-request.yml) and
  describe the problem before the solution.
- **Code** — fixes and features are welcome. For anything larger than a small fix, open an issue
  first so we can agree on the approach before you invest time.
- **Documentation** — corrections to the README, `.env.example`, and inline docs are always useful.

## Development setup

Fourier needs **Bun ≥ 1.4.0**, **ffmpeg ≥ 4.1** on `PATH`, and a **PostgreSQL** database (a Neon
project works well). See the README's [Quick start](README.md#quick-start) for credentials and
first run.

```bash
bun install            # install dependencies
bun run dev            # bot with --watch (skips migrations)
bun run lint           # biome check
bun run typecheck      # tsc --noEmit
bun run test           # bun:test behavior suite
bun run format         # biome format --write
```

Before opening a pull request, run the same checks CI runs, in this order:

```bash
bun run lint && bun run typecheck && bun run test
```

## Project conventions

- **TypeScript on Bun.** No build step is needed to run from source; `bun run build` is only for the
  `dist/` output.
- **Explicit dependency injection.** Everything is wired by hand in `src/compose.ts` with
  constructor injection. There is no DI container — do not introduce module-level singletons.
- **Biome owns style.** Formatting is not a review topic: run `bun run format` and let Biome decide.
- **Logging.** Use the existing `debug` namespaces (`src/utils/debug.ts`) and
  `src/utils/logError.ts`. Avoid `console.log` in application code.
- **Database.** PostgreSQL through `bun:sql`, no ORM. Schema changes go in `migrations/pg/*.sql`,
  and SQL belongs in `src/db/repositories/`.
- **Never read message content.** Fourier requests the minimum intents and permissions. Do not add
  privileged intents or broaden the invite.
- **Pin workflow actions.** Every `uses:` in `.github/workflows` must reference a full 40-character
  commit SHA with a `# vX.Y.Z` comment (Dependabot keeps them current). Declare the narrowest
  `permissions:` a job needs.
- **Tests.** `bun test --isolate` is required (it prevents `mock.module()` collisions across files).
  Tests must be hermetic: no live Postgres, no network, no real ffmpeg/yt-dlp.

## Commits and pull requests

Fourier uses [Conventional Commits](https://www.conventionalcommits.org/) and squash merging, because
[release-please](https://github.com/googleapis/release-please) derives the next version and the
changelog from the commit on `main`.

- **PR titles must be Conventional Commits**: `type(scope): subject`, for example
  `fix(player): skip unplayable tracks instead of stalling` or `feat(queue): add /shuffle`.
  Use `!` (for example `feat(player)!: …`) for a breaking change. The `PR Title` workflow enforces
  this; the allowed types and scopes are listed in `.github/workflows/pr-title.yml`.
- **Do not edit `CHANGELOG.md` or the `version` in `package.json`.** release-please owns both and
  will overwrite hand-written changes.
- Fill in the [pull request template](.github/pull_request_template.md). Link the issue it closes.
- Add or update tests for behaviour changes.
- Update the documentation (`README.md`, `.env.example`, …) when behaviour or configuration changes.

CI runs lint, type-check, and the test suite, plus CodeQL and a dependency review. CodeRabbit will
also leave review comments; treat them as suggestions, not blockers.

See [RELEASING.md](RELEASING.md) for how releases are cut.

## Licensing

Fourier is licensed under the [AGPL-3.0](LICENSE) and contains MIT-licensed code derived from
[Muse](https://github.com/museofficial/muse) (see [NOTICE](NOTICE) and [LICENSE-MIT](LICENSE-MIT)).

By submitting a contribution you agree that it is your own work, or that you have the right to
submit it, and that it may be distributed under the project's licence.
