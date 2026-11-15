import type { Client, VoiceChannel } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';
import type Config from './config.js';
import type { LavalinkNodeConfig } from './lavalinkBackend.js';
import type { QueuedSong } from './playerTypes.js';

export type { LavalinkNodeConfig } from './lavalinkBackend.js';

export function parseLavalinkNodes(raw: string): LavalinkNodeConfig[] {
  const value = raw.trim();
  if (!value) {
    return [];
  }

  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .map((entry) => {
          const node = entry as Record<string, unknown>;
          return {
            host: String(node.host ?? ''),
            port: Number(node.port ?? 2333),
            password: String(node.password ?? ''),
            secure: Boolean(node.secure),
          };
        })
        .filter((node) => node.host && node.password);
    } catch {
      return [];
    }
  }

  return value
    .split(/[,;]+/)
    .map((entry) => {
      const [host, port, password, secure] = entry.trim().split(':');
      return {
        host: host ?? '',
        port: Number(port ?? 2333),
        password: password ?? '',
        secure: secure === 'true',
      };
    })
    .filter((node) => node.host && node.password);
}

/**
 * Owns the shared Shoukaku node pool, health state and per-guild fallback
 * flags. A single instance is created at startup and handed to PlayerManager.
 */
export default class LavalinkService {
  private readonly client: Client;
  private readonly nodes: LavalinkNodeConfig[];
  public readonly shoukaku: Shoukaku | null;
  private available = false;
  private readonly guildFallbackUntil = new Map<string, number>();
  private consecutiveFailures = 0;
  public fallbackCount = 0;
  public lavalinkPlayCount = 0;

  constructor(config: Config, client: Client) {
    this.client = client;
    this.nodes = parseLavalinkNodes(config.LAVALINK_NODES);
    if (this.nodes.length === 0) {
      this.shoukaku = null;
      return;
    }

    this.shoukaku = new Shoukaku(
      new Connectors.DiscordJS(client),
      this.nodes.map((node) => ({
        name: `${node.host}:${node.port}`,
        url: `${node.host}:${node.port}`,
        auth: node.password,
        secure: node.secure ?? false,
      })),
      {
        moveOnDisconnect: true,
        resume: true,
        resumeTimeout: 30,
        resumeByLibrary: true,
        reconnectTries: 3,
        restTimeout: 10_000,
        voiceConnectionTimeout: 15_000,
      },
    );

    this.shoukaku.on('ready', () => {
      this.available = true;
      this.guildFallbackUntil.clear();
    });
    this.shoukaku.on('disconnect', () => {
      if (this.shoukaku && [...this.shoukaku.nodes.values()].every((node) => !node.state)) {
        this.available = false;
      }
    });
  }

  isEnabled(): boolean {
    return this.nodes.length > 0;
  }

  isAvailable(): boolean {
    return this.shoukaku !== null && this.available;
  }

  async connect(): Promise<boolean> {
    if (!this.shoukaku) {
      return false;
    }

    // Wait briefly for at least one node to become ready.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (this.isAvailable()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return this.isAvailable();
  }

  markGuildFallback(guildId: string, reason: string): void {
    this.guildFallbackUntil.set(guildId, Date.now() + 60_000);
    this.consecutiveFailures += 1;
    this.fallbackCount += 1;
    console.warn(`[lavalink] falling back to local for guild ${guildId}: ${reason}`);
    if (this.consecutiveFailures >= 3) {
      this.available = false;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  isGuildFallback(guildId: string): boolean {
    const until = this.guildFallbackUntil.get(guildId);
    if (!until) {
      return false;
    }
    if (Date.now() > until) {
      this.guildFallbackUntil.delete(guildId);
      return false;
    }
    return true;
  }

  shouldUseLavalink(guildId: string): boolean {
    return this.isEnabled() && this.isAvailable() && !this.isGuildFallback(guildId);
  }

  clearGuildFallback(guildId: string): void {
    this.guildFallbackUntil.delete(guildId);
  }

  async resolveEncoded(song: QueuedSong): Promise<string | null> {
    if (!this.shoukaku) {
      return null;
    }
    const node = this.shoukaku.getIdealNode();
    if (!node) {
      return null;
    }
    const identifier =
      song.source === 0 /* MediaSource.Youtube */ && !/^https?:\/\//.test(song.url)
        ? `https://www.youtube.com/watch?v=${song.url}`
        : song.url;
    try {
      const response = await node.rest.resolve(identifier);
      if (!response) {
        return null;
      }
      if (response.loadType === 'track') {
        return response.data.encoded;
      }
      if (response.loadType === 'search' && response.data.length > 0) {
        return response.data[0].encoded;
      }
      if (response.loadType === 'playlist' && response.data.tracks.length > 0) {
        return response.data.tracks[0].encoded;
      }
      return null;
    } catch {
      return null;
    }
  }

  async joinVoiceChannel(channel: VoiceChannel): Promise<unknown> {
    if (!this.shoukaku) {
      throw new Error('Lavalink not available');
    }
    return this.shoukaku.joinVoiceChannel({
      guildId: channel.guild.id,
      shardId: 0,
      channelId: channel.id,
      deaf: false,
    });
  }

  async leaveVoiceChannel(guildId: string): Promise<void> {
    if (!this.shoukaku) {
      return;
    }
    await this.shoukaku.leaveVoiceChannel(guildId);
  }

  getActivePathLabel(guildId: string): string {
    if (!this.isEnabled()) {
      return 'local (lavalink not configured)';
    }
    if (!this.isAvailable()) {
      return 'local (lavalink unavailable)';
    }
    if (this.isGuildFallback(guildId)) {
      return 'local (fallback)';
    }
    return 'lavalink';
  }
}
