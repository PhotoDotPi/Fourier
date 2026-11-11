import { ActivityType, type Client, type PresenceStatusData, type VoiceChannel } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { ONE_HOUR_IN_SECONDS } from '../utils/constants.js';
import { truncate } from '../utils/string.js';
import type Config from './config.js';
import type KeyValueCacheProvider from './keyValueCache.js';
import type Player from './player.js';
import { type MediaSource, STATUS } from './player.js';
import type { QueuedSong } from './playerTypes.js';

const recentTracksKey = (guildId: string) => `recent-tracks:${guildId}`;
const RECENT_TRACKS_LIMIT = 10;
const PRESENCE_DEBOUNCE_MS = 1_000;

interface RecentTrack {
  title: string;
  url: string;
  source: MediaSource;
}

export type { RecentTrack };

const getChannelStatusText = (player: Player): string | null => {
  const song = player.getCurrent();

  if (!song) {
    return null;
  }

  const state = player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused';
  return `${player.status === STATUS.PLAYING ? '▶' : '⏸'} ${state}: ${truncate(song.title, 80)}`;
};

const getNowPlayingTitle = (player: Player): string => player.getCurrent()?.title ?? '';

export default class PlayerIntegrations {
  private readonly playerManager: PlayerManager;
  private readonly client: Client;
  private readonly config: Config;
  private readonly cache: KeyValueCacheProvider;
  private readonly players = new Map<string, Player>();
  private lastPresenceActivity = '';
  private lastPresenceStatus: PresenceStatusData = 'online';
  private presenceUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(playerManager: PlayerManager, client: Client, config: Config, cache: KeyValueCacheProvider) {
    this.playerManager = playerManager;
    this.client = client;
    this.config = config;
    this.cache = cache;

    playerManager.onPlayerCreate((player) => {
      this.players.set(player.guildId, player);
      this.subscribeToPlayer(player);
    });
  }

  async recordRecentTrack(guildId: string, song: QueuedSong): Promise<void> {
    const recent = await this.getRecentTracks(guildId);
    const deduped = recent.filter((track) => track.url !== song.url);
    deduped.unshift({ title: song.title, url: song.url, source: song.source });
    const trimmed = deduped.slice(0, RECENT_TRACKS_LIMIT);

    await this.cache.set(recentTracksKey(guildId), trimmed, ONE_HOUR_IN_SECONDS);
  }

  async getRecentTracks(guildId: string): Promise<RecentTrack[]> {
    return (await this.cache.get<RecentTrack[]>(recentTracksKey(guildId))) ?? [];
  }

  private subscribeToPlayer(player: Player): void {
    player.on('trackStart', (song) => {
      void this.recordRecentTrack(player.guildId, song).catch(() => {});
      void this.updateChannelStatus(player).catch(() => {});
      this.schedulePresenceRefresh();
    });
    player.on('trackEnd', () => {
      void this.updateChannelStatus(player).catch(() => {});
      this.schedulePresenceRefresh();
    });
    player.on('statusChange', () => {
      void this.updateChannelStatus(player).catch(() => {});
      this.schedulePresenceRefresh();
    });
    player.on('disconnect', () => {
      void this.clearChannelStatus(player).catch(() => {});
      this.schedulePresenceRefresh();
    });
    player.on('connect', () => {
      this.players.set(player.guildId, player);
      void this.updateChannelStatus(player).catch(() => {});
    });
  }

  private async updateChannelStatus(player: Player): Promise<void> {
    const channel = player.getChannel();
    if (!channel) {
      return;
    }

    const text = getChannelStatusText(player);
    await this.setChannelStatus(channel, text);
  }

  private async clearChannelStatus(player: Player): Promise<void> {
    const channel = player.getChannel();
    if (!channel) {
      return;
    }

    await this.setChannelStatus(channel, null);
  }

  private async setChannelStatus(channel: VoiceChannel, text: string | null): Promise<void> {
    if (!channel.guild.members.me?.permissionsIn(channel).has('ManageChannels')) {
      return;
    }

    try {
      await this.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: text ?? '' } });
    } catch {}
  }

  private schedulePresenceRefresh(): void {
    if (this.presenceUpdateTimer) {
      clearTimeout(this.presenceUpdateTimer);
    }

    this.presenceUpdateTimer = setTimeout(() => {
      void this.refreshPresence().catch((error) => {
        console.error('Failed to refresh presence:', error);
      });
    }, PRESENCE_DEBOUNCE_MS);
  }

  private async refreshPresence(): Promise<void> {
    const activePlayers = [...this.players.values()];

    const mostActivePlayer = activePlayers
      .filter((player) => player.status !== STATUS.IDLE && player.voiceConnection)
      .sort((a, b) => (b.status === STATUS.PLAYING ? 1 : 0) - (a.status === STATUS.PLAYING ? 1 : 0))[0];

    let activityName = this.config.BOT_ACTIVITY;
    let activityType: Exclude<ActivityType, ActivityType.Custom> = this.config.BOT_ACTIVITY_TYPE;

    if (mostActivePlayer?.getCurrent()) {
      activityName = `${mostActivePlayer.status === STATUS.PLAYING ? '▶' : '⏸'} ${getNowPlayingTitle(mostActivePlayer)}`;
      activityType = ActivityType.Listening;
    }

    if (activityName === this.lastPresenceActivity && this.lastPresenceStatus === this.config.BOT_STATUS) {
      return;
    }

    this.lastPresenceActivity = activityName;
    this.lastPresenceStatus = this.config.BOT_STATUS;

    await this.client.user?.setPresence({
      activities: [
        {
          name: activityName,
          type: activityType,
          url: this.config.BOT_ACTIVITY_URL === '' ? undefined : this.config.BOT_ACTIVITY_URL,
        },
      ],
      status: this.config.BOT_STATUS,
    });
  }
}
