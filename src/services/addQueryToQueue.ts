import {
  type APIInteractionGuildMember,
  type GuildMember,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  MessageFlags,
  type MessagePayload,
  type TextBasedChannel,
} from 'discord.js';
import { ResponseError, SponsorBlock } from 'sponsorblock-api';
import { Emoji } from '../constants/emoji.js';
import type PlayerManager from '../managers/player.js';
import type GetSongs from '../services/getSongs.js';
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
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK ? new SponsorBlock('fourier-sb-integration') : undefined;
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

    const { playlistLimit, queueAddResponseEphemeral } = settings;

    await interaction.deferReply(queueAddResponseEphemeral ? { flags: MessageFlags.Ephemeral } : {});

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

    const firstSong = newSongs[0];

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

    if (shouldShowPlayingEmbed) {
      const payload = await this.presenter.buildPlayingPayloadGuarded(player);
      if (payload) {
        await interaction.editReply({
          embeds: payload.embeds,
          files: payload.files,
          components: [],
        });
      }
    }

    let didSkipCurrentTrack = false;
    if (skipCurrentTrack && isSameQueueEntry(currentQueueEntryId, player.getCurrentQueueEntryId())) {
      try {
        await player.forward(1);
        didSkipCurrentTrack = true;
      } catch (error: unknown) {
        throw normalizeSkipError(error);
      }
    }

    if (statusMsg !== '') {
      if (extraMsg === '') {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    if (extraMsg !== '') {
      extraMsg = ` (${extraMsg})`;
    }

    const queueSummary =
      newSongs.length === 1
        ? `**${firstSong.title}** added to the${addToFrontOfQueue ? ' front of the' : ''} queue${didSkipCurrentTrack ? ' and current track skipped' : ''}`
        : `**${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue${didSkipCurrentTrack ? ' and current track skipped' : ''}`;

    await interaction.editReply({
      embeds: [buildSuccessEmbed(queueSummary).setTitle(`${Emoji.Music} Added to queue${extraMsg}`)],
    });
  }

  private async skipNonMusicSegments(song: SongMetadata) {
    if (
      !this.sponsorBlock ||
      (this.sponsorBlockDisabledUntil && new Date() < this.sponsorBlockDisabledUntil) ||
      song.source !== MediaSource.Youtube ||
      !song.url
    ) {
      return song;
    }

    try {
      const segments =
        (await this.cache.wrap(async () => this.sponsorBlock?.getSegments(song.url, ['music_offtopic']), {
          key: song.url,
          expiresIn: ONE_HOUR_IN_SECONDS,
        })) ?? [];
      const skipSegments = segments
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

      const intro = skipSegments[0];
      const outro = skipSegments.at(-1);
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
    } catch (error) {
      if (!(error instanceof Error)) {
        console.error('Unexpected event occurred while fetching skip segments : ', error);
        return song;
      }

      if (error instanceof ResponseError && error.status === 404) {
        debug(`SponsorBlock has no skip segments for "${song.url}"`);
        return song;
      }

      console.warn(`Could not fetch skip segments for "${song.url}" :`, error);

      if (error instanceof ResponseError && error.status === 504) {
        this.sponsorBlockDisabledUntil = new Date(Date.now() + this.sponsorBlockTimeoutDelay * 60_000);
      }

      return song;
    }
  }
}
