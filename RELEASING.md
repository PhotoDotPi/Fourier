# Releasing

Fourier is released with [release-please](https://github.com/googleapis/release-please) and
[Conventional Commits](https://www.conventionalcommits.org/). You do not edit `CHANGELOG.md` or bump
`package.json` by hand — release-please does both from the commit history on `main`.

## How it works

1. Merge pull requests into `main` using **squash merge**, with the PR title in Conventional Commits
   form (`fix(player): …`, `feat(queue): …`). The `PR Title` workflow enforces this.
2. The [`Release`](.github/workflows/release.yml) workflow runs on every push to `main` and keeps a
   single pull request open, titled `chore(main): release X.Y.Z`. That PR contains the version bump
   and the changelog for everything merged since the last release.
3. When you are ready to ship, **merge that release PR**. release-please then creates the `vX.Y.Z`
   tag and the GitHub release, which triggers
   [`release-comment.yml`](.github/workflows/release-comment.yml) to comment on the issues and pull
   requests included in the release.
4. Nothing else to do. The next push to `main` opens the next release PR.

Merging the release PR is the release. There is no local step, no token in your shell, and no manual
tagging.

## Version bumps

release-please picks the version from the commits since the last release:

| Commit / PR title          | Bump  |
| -------------------------- | ----- |
| `fix:`                     | patch |
| `feat:`                    | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`, `deps:` | patch |

`refactor`, `docs`, `test`, `build`, `ci`, `chore` and `deps` are hidden from the changelog but still
count towards the version. See
[`.release-please-config.json`](.release-please-config.json) for the section mapping.

## First release (1.0.0)

`CHANGELOG.md` starts at `1.0.0` and `.release-please-manifest.json` records `1.0.0`. To publish it:

1. Merge this branch into `main`.
2. Tag the release commit and create the GitHub release for `v1.0.0` (the entry is already written in
   `CHANGELOG.md`).

From `1.0.1` onwards, release-please owns both the changelog and the tag.

## Prerequisite

The `Release` workflow needs write access to create pull requests and releases. The default
`GITHUB_TOKEN` is sufficient, but check that **Settings → Actions → General → Workflow permissions**
is set to *Read and write permissions*, or that the workflow's `permissions` block is allowed to
grant `contents: write` and `pull-requests: write`.
