import type FileCacheProvider from '../services/fileCache.js';
import Player from '../services/player.js';
import { STATUS } from '../services/playerTypes.js';
import type YoutubeAPI from '../services/youtubeApi.js';

const IDLE_CLEANUP_INTERVAL_MS = 60_000;
const IDLE_CLEANUP_THRESHOLD_MS = 5 * 60_000;

export default class PlayerManager {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly youtubeAPI: YoutubeAPI;
  private readonly lastActiveTimes: Map<string, number>;
  private readonly playerCreateListeners: Array<(player: Player) => void>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(fileCache: FileCacheProvider, youtubeAPI: YoutubeAPI) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.youtubeAPI = youtubeAPI;
    this.lastActiveTimes = new Map();
    this.playerCreateListeners = [];
    this.startCleanupTimer();
  }

  onPlayerCreate(listener: (player: Player) => void): void {
    this.playerCreateListeners.push(listener);
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId, async (song) => this.youtubeAPI.findAudioFallback(song));

      this.guildPlayers.set(guildId, player);
      if (this.cleanupTimer === null) {
        this.startCleanupTimer();
      }
      for (const listener of this.playerCreateListeners) {
        listener(player);
      }
    }

    this.lastActiveTimes.set(guildId, Date.now());
    return player;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdlePlayers();
    }, IDLE_CLEANUP_INTERVAL_MS);
  }

  private cleanupIdlePlayers(): void {
    const now = Date.now();

    for (const [guildId, player] of this.guildPlayers) {
      const lastActive = this.lastActiveTimes.get(guildId) ?? 0;
      const isIdle =
        player.voiceConnection === null && (player.status === STATUS.IDLE || player.status === STATUS.PAUSED);
      const idleDuration = now - lastActive;

      if (isIdle && idleDuration > IDLE_CLEANUP_THRESHOLD_MS) {
        this.guildPlayers.delete(guildId);
        this.lastActiveTimes.delete(guildId);
      }
    }

    if (this.guildPlayers.size === 0 && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
