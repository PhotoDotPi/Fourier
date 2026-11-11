import type { Snowflake } from 'discord.js';

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string;
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
}

export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export type AgeRestrictedFallbackResolver = (song: QueuedSong) => Promise<SongMetadata | null>;

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  trackStart: (song: QueuedSong) => void;
  trackEnd: (song: QueuedSong | null) => void;
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
  volumeChange: (volume: number) => void;
  loopChange: () => void;
  queueChange: () => void;
  connect: () => void;
  disconnect: () => void;
  speakingStart: (userId: string) => void;
  speakingEnd: (userId: string) => void;
}

export type PlayerEventName = keyof PlayerEvents;

export const DEFAULT_VOLUME = 100;
