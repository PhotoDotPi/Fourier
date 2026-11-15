# Changelog

All notable changes to Fourier are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/PhotoDotPi/Fourier/compare/v1.0.1...v1.1.0) (2026-11-15)


### Features

* add PlaybackBackend interface and put local pipeline behind it ([#13](https://github.com/PhotoDotPi/Fourier/issues/13)) ([#18](https://github.com/PhotoDotPi/Fourier/issues/18)) ([3fd782b](https://github.com/PhotoDotPi/Fourier/commit/3fd782bd55072d4d8a16521d1e2943924c9726bd))
* implement Lavalink backend with Shoukaku ([#14](https://github.com/PhotoDotPi/Fourier/issues/14)) ([#20](https://github.com/PhotoDotPi/Fourier/issues/20)) ([819699e](https://github.com/PhotoDotPi/Fourier/commit/819699e6e55323908efd591e7061e81dee49e336))
* make Lavalink default with automatic local fallback ([#15](https://github.com/PhotoDotPi/Fourier/issues/15)) ([#21](https://github.com/PhotoDotPi/Fourier/issues/21)) ([83b982e](https://github.com/PhotoDotPi/Fourier/commit/83b982ed64dcceffa5093aeab15910f1a4d33d9d))

## [1.0.1](https://github.com/PhotoDotPi/Fourier/compare/v1.0.0...v1.0.1) (2026-11-12)


### Bug Fixes

* **ci:** use underscore input names for first-interaction action ([a492dae](https://github.com/PhotoDotPi/Fourier/commit/a492daebc6e623e8c3f9ee720b56c531969a1aba))
* **deps:** remove unmaintained and outdated dependencies ([#5](https://github.com/PhotoDotPi/Fourier/issues/5)) ([8463492](https://github.com/PhotoDotPi/Fourier/commit/84634922f6974e37f34ec8b04139f58f5d798fa9))
* **deps:** remove unmaintained and outdated dependencies ([#5](https://github.com/PhotoDotPi/Fourier/issues/5)) ([7a81027](https://github.com/PhotoDotPi/Fourier/commit/7a8102717d651379ed51e07fc9ee8a918f97e804))
* **release:** align manifest root component ([7b161fb](https://github.com/PhotoDotPi/Fourier/commit/7b161fba145787bc3ece3cf94d37743fb8780ced))
* **release:** bootstrap release-please from initial commit ([ec8e9fb](https://github.com/PhotoDotPi/Fourier/commit/ec8e9fb8ff21327a67e494234ac9eef1b559f3a0))
* **release:** force release-please version 1.0.1 ([283ae2f](https://github.com/PhotoDotPi/Fourier/commit/283ae2f9e569ac62cece32062396b43b64bbbb2e))
* **release:** use empty component in manifest ([5c51475](https://github.com/PhotoDotPi/Fourier/commit/5c51475bac1bd90b1987145b5d9fd121c686bbc2))
* **release:** use manifest packages config format ([83646fc](https://github.com/PhotoDotPi/Fourier/commit/83646fc94b6a27922338ab83483024a7b7dc7c6b))

## [Unreleased]

## [1.0.0] - 2026-11-11

First release of Fourier.

**Playback**

- YouTube videos, playlists, and livestreams, including direct and `.m3u8` URLs
- Optional Spotify track, album, playlist, and artist URL conversion
- Search suggestions on `/play`, with recent tracks shown first when the field is empty
- Absolute and relative seeking (`/seek`, `/fseek`; `1m 30s` is accepted)
- YouTube chapters as individual queue entries (opt-in with `/play split:*`)
- Track and queue looping, `/replay`, `/unskip`, volume from 0 to 100
- Automatic ducking: music lowers while people speak
- Optional SponsorBlock skipping for intros and ads
- Retries, voice-connection recovery, and unplayable tracks skipped instead of stalling the player

**Queue and library**

- Paginated `/queue`, plus `/clear` (with confirmation), `/remove`, `/move`, and `/shuffle`
- Named favorites: `/favorites create`, `use`, `list`, and `remove`
- Content-hash audio cache on disk, bounded by `CACHE_LIMIT` (default 2 GB)
- Persistent player panel (`/setup panel`) with pause, skip, stop, shuffle, loop, volume, and search
- Voice channel status showing the current track, where permissions allow
- Automatic leave: 30 seconds after the queue empties, or when everyone else has left
- Multiple guilds with isolated queues, settings, and panels
- Per-guild option to show queue confirmations only to the requester

**Configuration**

- Per-guild settings for playlist limits, leave behaviour, ducking, default volume, and queue pages
- Optional age-verified YouTube cookie file for age-restricted playback
- Optional `yt-dlp` auto-update at startup

[Unreleased]: https://github.com/PhotoDotPi/Fourier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PhotoDotPi/Fourier/releases/tag/v1.0.0
