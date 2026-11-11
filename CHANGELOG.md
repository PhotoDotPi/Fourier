# Changelog

All notable changes to Fourier are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
