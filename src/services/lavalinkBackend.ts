import { EventEmitter } from 'node:events';
import type { VoiceChannel } from 'discord.js';
import type { PlaybackBackend, PlaybackBackendKind } from './playbackBackend.js';
import type { QueuedSong } from './playerTypes.js';
import { STATUS } from './playerTypes.js';

export interface LavalinkNodeConfig {
  host: string;
  port: number;
  password: string;
  secure?: boolean;
}

export interface LavalinkBackendOptions {
  guildId: string;
  service: import('./lavalinkService.js').default;
  getCurrent: () => QueuedSong | null;
  getCurrentEntryId: () => number | null;
  onTrackStart?: (song: QueuedSong) => void;
  onTrackEnd?: (
    song: QueuedSong | null,
    reason: 'finished' | 'stopped' | 'replaced' | 'loadFailed' | 'cleanup',
  ) => void;
  onTrackException?: (song: QueuedSong | null, error: Error) => void;
  onTrackStuck?: (song: QueuedSong | null, thresholdMs: number) => void;
}

/**
 * Per-guild Lavalink backend. Shares the node pool owned by LavalinkService.
 */
export default class LavalinkBackend extends EventEmitter implements PlaybackBackend {
  public readonly kind: PlaybackBackendKind = 'lavalink';
  public status = STATUS.IDLE;

  private readonly guildId: string;
  private readonly service: LavalinkBackendOptions['service'];
  private readonly getCurrentSong: () => QueuedSong | null;
  private readonly getCurrentEntryId: () => number | null;
  private readonly callbacks: Pick<
    LavalinkBackendOptions,
    'onTrackStart' | 'onTrackEnd' | 'onTrackException' | 'onTrackStuck'
  >;

  private channel: VoiceChannel | undefined;
  private player: import('shoukaku').Player | null = null;
  private currentSong: QueuedSong | null = null;
  private position = 0;
  private positionStartedAt = 0;
  private paused = false;
  private lastPlayerUpdateAt = 0;

  constructor(options: LavalinkBackendOptions) {
    super();
    this.guildId = options.guildId;
    this.service = options.service;
    this.getCurrentSong = options.getCurrent;
    this.getCurrentEntryId = options.getCurrentEntryId;
    this.callbacks = {
      onTrackStart: options.onTrackStart,
      onTrackEnd: options.onTrackEnd,
      onTrackException: options.onTrackException,
      onTrackStuck: options.onTrackStuck,
    };
  }

  async connect(channel: VoiceChannel): Promise<void> {
    this.channel = channel;
    const player = (await this.service.joinVoiceChannel(channel)) as import('shoukaku').Player;
    this.player = player;
    this.wirePlayer(player);
    this.status = STATUS.PAUSED;
  }

  disconnect(): void {
    this.player = null;
    this.status = STATUS.IDLE;
    void this.service.leaveVoiceChannel(this.guildId);
    this.channel = undefined;
    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.player !== null;
  }

  getChannel(): VoiceChannel | undefined {
    return this.channel;
  }

  async play(): Promise<void> {
    const song = this.getCurrentSong() ?? this.currentSong;
    if (!song || !this.player) {
      throw new Error('No song to play');
    }
    this.currentSong = song;

    let encoded = song.encodedTrack ?? null;
    if (!encoded) {
      encoded = await this.service.resolveEncoded(song);
      if (encoded) {
        song.encodedTrack = encoded;
      }
    }
    if (!encoded) {
      throw new Error('No encoded track available for Lavalink');
    }

    const startSeconds = song.offset ?? 0;
    await this.player.playTrack({ track: { encoded } }, false);
    if (startSeconds > 0) {
      await this.player.seekTo(startSeconds * 1000);
    }
    if (song.isLive) {
      // live: no length/seek beyond start
    }

    this.position = startSeconds;
    this.positionStartedAt = Date.now();
    this.paused = false;
    this.status = STATUS.PLAYING;
    this.service.lavalinkPlayCount += 1;
    this.emit('trackStart', song);
    this.callbacks.onTrackStart?.(song);
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      return;
    }
    this.position = this.getPosition();
    this.paused = true;
    this.status = STATUS.PAUSED;
    void this.player?.setPaused(true);
    this.emit('statusChange', STATUS.PLAYING, this.status);
  }

  resume(): void {
    if (this.status !== STATUS.PAUSED) {
      return;
    }
    this.positionStartedAt = Date.now();
    this.paused = false;
    this.status = STATUS.PLAYING;
    void this.player?.setPaused(false);
    if (this.currentSong) {
      this.emit('trackStart', this.currentSong);
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    if (!this.player || !this.currentSong) {
      return;
    }
    if (this.currentSong.isLive) {
      return;
    }
    const target = Math.max(0, Math.min(positionSeconds, this.currentSong.length));
    await this.player.seekTo(target * 1000);
    this.position = target;
    this.positionStartedAt = Date.now();
  }

  setVolume(level: number): void {
    void this.player?.setGlobalVolume(level * 10); // Lavalink uses 0-1000
  }

  stop(): void {
    this.status = STATUS.IDLE;
    void this.player?.stopTrack();
  }

  getPosition(): number {
    if (!this.player) {
      return this.position;
    }
    if (this.paused) {
      return this.position;
    }
    const base = this.player.position ?? this.position * 1000;
    const delta = Math.floor((Date.now() - this.lastPlayerUpdateAt) / 1000);
    const seconds = Math.floor(base / 1000) + (this.lastPlayerUpdateAt ? delta : 0);
    return Math.min(seconds, this.currentSong?.length ?? seconds);
  }

  getStatus(): number {
    return this.status;
  }

  getCurrent(): QueuedSong | null {
    return this.currentSong;
  }

  getCurrentQueueEntryId(): number | null {
    return this.getCurrentEntryId();
  }

  private wirePlayer(player: import('shoukaku').Player): void {
    player.on('start', (_event) => {
      this.lastPlayerUpdateAt = Date.now();
      this.positionStartedAt = Date.now();
      this.position = 0;
      this.emit('trackStart', this.currentSong ?? this.getCurrentSong());
    });
    player.on('end', (event) => {
      const reason = event.reason as 'finished' | 'stopped' | 'replaced' | 'loadFailed' | 'cleanup';
      const song = this.currentSong;
      if (reason === 'finished') {
        this.status = STATUS.IDLE;
        this.emit('trackEnd', song, reason);
        this.callbacks.onTrackEnd?.(song, reason);
      } else if (reason === 'loadFailed') {
        this.emit('trackException', song, new Error('Lavalink track failed to load'));
        this.callbacks.onTrackException?.(song, new Error('Lavalink track failed to load'));
      }
    });
    player.on('exception', (event) => {
      const song = this.currentSong;
      const error = new Error(event.exception.message);
      this.emit('trackException', song, error);
      this.callbacks.onTrackException?.(song, error);
    });
    player.on('stuck', (event) => {
      const song = this.currentSong;
      this.emit('trackStuck', song, event.thresholdMs);
      this.callbacks.onTrackStuck?.(song, event.thresholdMs);
    });
    player.on('update', (event) => {
      this.lastPlayerUpdateAt = Date.now();
      this.position = Math.floor(event.state.position / 1000);
    });
    player.on('closed', () => {
      this.service.markGuildFallback?.(this.guildId, 'node closed');
      this.emit('nodeDisconnected');
      this.callbacks.onTrackEnd?.(this.currentSong, 'loadFailed');
    });
  }
}
