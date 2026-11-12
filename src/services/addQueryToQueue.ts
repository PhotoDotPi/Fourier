import {
  type APIInteractionGuildMember,
  type GuildMember,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  MessageFlags,
  type MessagePayload,
  type TextBasedChannel,
} from 'discord.js';
import { Emoji } from '../constants/emoji.js';
import type PlayerManager from '../managers/player.js';
import type GetSongs from '../services/getSongs.js';
import { ResponseError, SponsorBlock, type SponsorSegment } from '../services/sponsorBlock.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { shuffle } from '../utils/arrays.js';
import { getMemberVoiceChannel, getMostPopularVoiceChannel } from '../utils/channels.js';
import { ONE_HOUR_IN_SECONDS } from '../utils/constants.js';
import debug from '../utils/debug.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import type Config from './config.js';
import type KeyValueCacheProvider from './keyValueCache.js';
import type NowPlayingPresenter from './nowPlayingPresenter.js';
import { MediaSource, type SongMetadata, STATUS } from './player.js';

const isSameQueueEntry = (capturedId: number | null, currentId: number | null) =>
  capturedId !== null && capturedId === currentId;

const normalizeSkipError = (error: unknown) =>
  error instanceof Error && error.message === 'No songs in queue to forward to.'
    ? new Error('no song to skip to')
    : error;

const formatExtraMsg = (statusMsg: string, extraMsg: string): string => {
  let formatted = extraMsg;

  if (statusMsg !== '') {
    formatted = formatted === '' ? statusMsg : `${statusMsg}, ${formatted}`;
  }

  return formatted === '' ? '' : ` (${formatted})`;
};

const buildQueueSummary = (
  firstSong: SongMetadata,
  songCount: number,
  addToFrontOfQueue: boolean,
  didSkipCurrentTrack: boolean,
): string => {
  const skipped = didSkipCurrentTrack ? ' and current track skipped' : '';

  if (songCount === 1) {
    return `**${firstSong.title}** added to the${addToFrontOfQueue ? ' front of the' : ''} queue${skipped}`;
  }

  return `**${firstSong.title}** and ${songCount - 1} other songs were added to the queue${skipped}`;
};

const mergeOverlappingSegments = (segments: SponsorSegment[]): Array<{ startTime: number; endTime: number }> =>
  segments
    .sort((a, b) => a.startTime - b.startTime)
    .reduce((acc: Array<{ startTime: number; endTime: number }>, { startTime, endTime }) => {
      const previousSegment = acc[acc.length - 1];

      if (previousSegment && previousSegment.endTime > startTime) {
        acc[acc.length - 1].endTime = Math.max(previousSegment.endTime, endTime);
      } else {
        acc.push({ startTime, endTime });
      }

      return acc;
    }, []);

const applySkipSegments = (song: SongMetadata, segments: Array<{ startTime: number; endTime: number }>) => {
  const intro = segments[0];
  const outro = segments.at(-1);
  const shouldTrimIntro = intro && intro.startTime <= 2;
  const shouldTrimOutro = outro && outro.endTime >= song.length - 2;

  if (shouldTrimOutro && (!shouldTrimIntro || outro !== intro)) {
    song.length -= Math.max(0, outro.endTime - outro.startTime);
  }

  if (shouldTrimIntro) {
    song.offset = Math.max(0, Math.floor(intro.endTime));
    song.length -= song.offset;
  }

  song.length = Math.max(0, song.length);

  return song;
};

type PlayerInstance = ReturnType<PlayerManager['get']>;

interface QueueInteraction {
  guild: GuildMember['guild'] | null;
  member: GuildMember | APIInteractionGuildMember | null;
  channel: TextBasedChannel | null;
  deferReply: (options?: InteractionDeferReplyOptions) => Promise<unknown>;
  editReply: (options: string | MessagePayload | InteractionEditReplyOptions) => Promise<unknown>;
}

export default class AddQueryToQueue {
  private readonly sponsorBlock?: SponsorBlock;
  private sponsorBlockDisabledUntil?: Date;
  private readonly sponsorBlockTimeoutDelay;
  private readonly cache: KeyValueCacheProvider;
  private readonly presenter: NowPlayingPresenter;

  constructor(
    private readonly getSongs: GetSongs,
    private readonly playerManager: PlayerManager,
    private readonly config: Config,
    cache: KeyValueCacheProvider,
    presenter: NowPlayingPresenter,
  ) {
    this.sponsorBlockTimeoutDelay = config.SPONSORBLOCK_TIMEOUT;
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK ? new SponsorBlock() : undefined;
    this.cache = cache;
    this.presenter = presenter;
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    skipCurrentTrack: boolean;
    interaction: QueueInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);
    const currentQueueEntryId = player.getCurrentQueueEntryId();
    const wasPlayingSong = currentQueueEntryId !== null;

    const [targetVoiceChannel] =
      getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await getGuildSettings(guildId);

    await interaction.deferReply(settings.queueAddResponseEphemeral ? { flags: MessageFlags.Ephemeral } : {});

    const [newSongs, extraMsg] = await this.resolveSongs(
      query,
      settings.playlistLimit,
      shouldSplitChapters,
      shuffleAdditions,
    );

    this.addSongsToPlayer(player, newSongs, interaction, addToFrontOfQueue);

    const { statusMsg, shouldShowPlayingEmbed } = await this.startPlayback(player, targetVoiceChannel, wasPlayingSong);

    if (shouldShowPlayingEmbed) {
      await this.showPlayingPayload(player, interaction);
    }

    const didSkipCurrentTrack = await this.skipCurrentTrackIfRequested(player, currentQueueEntryId, skipCurrentTrack);

    const queueSummary = buildQueueSummary(newSongs[0], newSongs.length, addToFrontOfQueue, didSkipCurrentTrack);

    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(queueSummary).setTitle(`${Emoji.Music} Added to queue${formatExtraMsg(statusMsg, extraMsg)}`),
      ],
    });
  }

  private async resolveSongs(
    query: string,
    playlistLimit: number,
    shouldSplitChapters: boolean,
    shuffleAdditions: boolean,
  ): Promise<[SongMetadata[], string]> {
    let [newSongs, extraMsg] = await this.getSongs.getSongs(query, playlistLimit, shouldSplitChapters);

    if (newSongs.length === 0) {
      throw new Error('no songs found');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(newSongs.map(this.skipNonMusicSegments.bind(this)));
    }

    return [newSongs, extraMsg];
  }

  private addSongsToPlayer(
    player: PlayerInstance,
    newSongs: SongMetadata[],
    interaction: QueueInteraction,
    addToFrontOfQueue: boolean,
  ): void {
    newSongs.forEach((song, index) => {
      player.add(
        {
          ...song,
          addedInChannelId: interaction.channel!.id,
          requestedBy: interaction.member!.user.id,
        },
        {
          immediate: addToFrontOfQueue ?? false,
          immediateOffset: index,
        },
      );
    });
  }

  private async startPlayback(
    player: PlayerInstance,
    targetVoiceChannel: Parameters<PlayerInstance['connect']>[0],
    wasPlayingSong: boolean,
  ): Promise<{ statusMsg: string; shouldShowPlayingEmbed: boolean }> {
    let statusMsg = '';
    let shouldShowPlayingEmbed = false;

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);

      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'resuming playback';
      }

      shouldShowPlayingEmbed = true;
    } else if (player.status === STATUS.IDLE) {
      await player.play();
    }

    if (!player.getCurrent()) {
      throw new Error('no playable songs found');
    }

    return { statusMsg, shouldShowPlayingEmbed };
  }

  private async showPlayingPayload(player: PlayerInstance, interaction: QueueInteraction): Promise<void> {
    const payload = await this.presenter.buildPlayingPayloadGuarded(player);

    if (payload) {
      await interaction.editReply({
        embeds: payload.embeds,
        files: payload.files,
        components: [],
      });
    }
  }

  private async skipCurrentTrackIfRequested(
    player: PlayerInstance,
    currentQueueEntryId: number | null,
    skipCurrentTrack: boolean,
  ): Promise<boolean> {
    if (!skipCurrentTrack || !isSameQueueEntry(currentQueueEntryId, player.getCurrentQueueEntryId())) {
      return false;
    }

    try {
      await player.forward(1);
      return true;
    } catch (error: unknown) {
      throw normalizeSkipError(error);
    }
  }

  private shouldCheckSponsorBlock(song: SongMetadata): song is SongMetadata & { url: string } {
    if (!this.sponsorBlock) {
      return false;
    }

    if (this.sponsorBlockDisabledUntil && new Date() < this.sponsorBlockDisabledUntil) {
      return false;
    }

    return song.source === MediaSource.Youtube && Boolean(song.url);
  }

  private async getSkipSegments(url: string): Promise<Array<{ startTime: number; endTime: number }>> {
    const segments =
      (await this.cache.wrap(async () => this.sponsorBlock?.getSegments(url, ['music_offtopic']), {
        key: url,
        expiresIn: ONE_HOUR_IN_SECONDS,
      })) ?? [];

    return mergeOverlappingSegments(segments);
  }

  private handleSkipSegmentError(error: unknown, url: string): void {
    if (!(error instanceof Error)) {
      console.error('Unexpected event occurred while fetching skip segments : ', error);
      return;
    }

    if (error instanceof ResponseError && error.status === 404) {
      debug(`SponsorBlock has no skip segments for "${url}"`);
      return;
    }

    console.warn(`Could not fetch skip segments for "${url}" :`, error);

    if (error instanceof ResponseError && error.status === 504) {
      this.sponsorBlockDisabledUntil = new Date(Date.now() + this.sponsorBlockTimeoutDelay * 60_000);
    }
  }

  private async skipNonMusicSegments(song: SongMetadata) {
    if (!this.shouldCheckSponsorBlock(song)) {
      return song;
    }

    try {
      const segments = await this.getSkipSegments(song.url);
      return applySkipSegments(song, segments);
    } catch (error) {
      this.handleSkipSegmentError(error, song.url);
      return song;
    }
  }
}
