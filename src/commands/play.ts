import { URL } from 'node:url';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { APIApplicationCommandOptionChoice } from 'discord-api-types/v10';
import type Spotify from 'spotify-web-api-node';
import type AddQueryToQueue from '../services/addQueryToQueue.js';
import type KeyValueCacheProvider from '../services/keyValueCache.js';
import { MediaSource } from '../services/player.js';
import type { RecentTrack } from '../services/playerIntegrations.js';
import type ThirdParty from '../services/thirdParty.js';
import { ONE_HOUR_IN_SECONDS } from '../utils/constants.js';
import getYouTubeAndSpotifySuggestionsFor, {
  SpotifySuggestionsUnavailableError,
} from '../utils/getYouTubeAndSpotifySuggestionsFor.js';
import type Command from './index.js';
import { addQueueOptions } from './playOptions.js';

const MAX_CHOICE_LENGTH = 100;
const SUPPORTED_PROTOCOLS = ['http:', 'https:', 'spotify:'];

const getUrlProtocol = (value: string): string | undefined => {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
};

const isUrlQuery = (value: string): boolean => {
  const protocol = getUrlProtocol(value);

  return Boolean(protocol && SUPPORTED_PROTOCOLS.includes(protocol));
};

const toRecentTrackChoice = (track: RecentTrack): APIApplicationCommandOptionChoice => {
  const url =
    track.source === MediaSource.Youtube && track.url.length === 11
      ? `https://www.youtube.com/watch?v=${track.url}`
      : track.url;

  return {
    name: `🕘 ${track.title}`.slice(0, MAX_CHOICE_LENGTH),
    value: url.slice(0, MAX_CHOICE_LENGTH),
  };
};

export default class Play implements Command {
  public readonly slashCommand: ReturnType<typeof this.buildCommand>;

  public requiresVC = true;

  private readonly spotify?: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;
  private readonly getRecentTracks: (guildId: string) => Promise<RecentTrack[]>;

  constructor(
    thirdParty: ThirdParty | undefined,
    cache: KeyValueCacheProvider,
    addQueryToQueue: AddQueryToQueue,
    getRecentTracks: (guildId: string) => Promise<RecentTrack[]> = async () => [],
  ) {
    this.spotify = thirdParty?.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;
    this.getRecentTracks = getRecentTracks;

    const queryDescription =
      thirdParty === undefined ? 'YouTube URL or search query' : 'YouTube URL, Spotify URL, or search query';

    this.slashCommand = this.buildCommand(queryDescription);
  }

  private buildCommand(queryDescription: string) {
    return addQueueOptions(
      new SlashCommandBuilder()
        .setName('play')
        .setDescription('play a song')
        .addStringOption((option) =>
          option.setName('query').setDescription(queryDescription).setAutocomplete(true).setRequired(true),
        ),
    );
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query')!;

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }

  public async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const query = interaction.options.getString('query')?.trim();

    if (!query) {
      await this.respondWithRecentTracks(interaction);
      return;
    }

    if (isUrlQuery(query)) {
      await interaction.respond([]);
      return;
    }

    const suggestions = await this.getSuggestions(query);
    await interaction.respond(suggestions);
  }

  private async respondWithRecentTracks(interaction: AutocompleteInteraction): Promise<void> {
    const recentTracks = await this.getRecentTracks(interaction.guildId ?? '');

    if (recentTracks.length === 0) {
      await interaction.respond([]);
      return;
    }

    await interaction.respond(recentTracks.slice(0, 25).map(toRecentTrackChoice));
  }

  private async getSuggestions(query: string): Promise<APIApplicationCommandOptionChoice[]> {
    try {
      return await this.cache.wrap(getYouTubeAndSpotifySuggestionsFor, query, this.spotify, 10, {
        expiresIn: ONE_HOUR_IN_SECONDS,
        key: `autocomplete:${query}`,
      });
    } catch (error: unknown) {
      if (error instanceof SpotifySuggestionsUnavailableError) {
        return error.suggestions;
      }

      throw error;
    }
  }
}
