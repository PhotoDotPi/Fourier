import type { VoiceChannel } from 'discord.js';
import type { PlayerEventName, QueuedSong } from './playerTypes.js';

/**
 * Which playback implementation is currently driving a player.
 *
 * `local` is the bundled yt-dlp + ffmpeg + @discordjs/voice pipeline.
 * `lavalink` streams through a Lavalink node via Shoukaku.
 */
export type PlaybackBackendKind = 'local' | 'lavalink';

/** Track end reasons reported by Lavalink, normalised to a small union. */
export type BackendTrackEndReason = 'finished' | 'stopped' | 'replaced' | 'loadFailed' | 'cleanup';

/** Events a backend must publish so the queue owner can react. */
export interface PlaybackBackendEvents {
  trackStart: (song: QueuedSong) => void;
  trackEnd: (song: QueuedSong | null, reason: BackendTrackEndReason) => void;
  trackException: (song: QueuedSong | null, error: Error) => void;
  trackStuck: (song: QueuedSong | null, thresholdMs: number) => void;
  nodeDisconnected: () => void;
  connect: () => void;
  disconnect: () => void;
  statusChange: (oldStatus: number, newStatus: number) => void;
}

export type PlaybackBackendEventName = keyof PlaybackBackendEvents;

/**
 * Contract between the queue-owning {@link Player} and a playback engine.
 *
 * The queue, loop mode and queue-entry identity stay in `Player`; a backend
 * only owns the transport (voice connection, decoder, clock) and reports
 * events back. Implementations must be safe to call when idle.
 */
export interface PlaybackBackend {
  readonly kind: PlaybackBackendKind;

  // Connection lifecycle
  connect(channel: VoiceChannel): Promise<void>;
  disconnect(): void | Promise<void>;
  isConnected(): boolean;
  getChannel(): VoiceChannel | undefined;

  // Playback control (operates on the backend's current track)
  play(): Promise<void>;
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
  seek(positionSeconds: number): Promise<void>;
  setVolume(level: number): void | Promise<void>;
  stop(): void | Promise<void> | undefined;

  // Observable state
  getPosition(): number;
  getStatus(): number;
  getCurrent(): QueuedSong | null;
  getCurrentQueueEntryId(): number | null;

  // Events (EventEmitter compatible)
  on(event: PlaybackBackendEventName, listener: (...args: unknown[]) => void): this;
  off(event: PlaybackBackendEventName, listener: (...args: unknown[]) => void): this;
}

/** Re-exported for backends that need to emit player-level events. */
export type { PlayerEventName };
