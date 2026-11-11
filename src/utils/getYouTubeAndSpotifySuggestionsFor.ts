import type { APIApplicationCommandOptionChoice } from 'discord-api-types/v10';
import type SpotifyWebApi from 'spotify-web-api-node';
import { Emoji } from '../constants/emoji.js';
import debug from './debug.js';
import getYouTubeSuggestionsFor from './getYouTubeSuggestionsFor.js';

export class SpotifySuggestionsUnavailableError extends Error {
  constructor(
    public readonly suggestions: APIApplicationCommandOptionChoice[],
    public readonly originalError: unknown,
  ) {
    super('Spotify autocomplete suggestions failed');
    this.name = 'SpotifySuggestionsUnavailableError';
  }
}

const playIcon = Emoji.Play;
const spotifyAlbumIcon = Emoji.SpotifyAlbum;
const spotifyTrackIcon = Emoji.SpotifyTrack;

const filterDuplicates = <T extends { name: string }>(items: T[]) => {
  const results: T[] = [];

  for (const item of items) {
    if (!results.some((result) => result.name === item.name)) {
      results.push(item);
    }
  }

  return results;
};

const getYouTubeAndSpotifySuggestionsFor = async (
  query: string,
  spotify?: SpotifyWebApi,
  limit = 10,
): Promise<APIApplicationCommandOptionChoice[]> => {
  const spotifySuggestionPromise =
    spotify === undefined
      ? undefined
      : spotify
          .search(query, ['album', 'track'], { limit })
          .then((response) => ({ response }))
          .catch((error: unknown) => ({ error }));

  const youtubeSuggestions = await getYouTubeSuggestionsFor(query);

  const totalYouTubeResults = youtubeSuggestions.length;
  const numOfYouTubeSuggestions = Math.min(limit, totalYouTubeResults);

  let suggestions: APIApplicationCommandOptionChoice[] = [];

  suggestions.push(
    ...youtubeSuggestions.slice(0, numOfYouTubeSuggestions).map((suggestion) => ({
      name: `${playIcon} ${suggestion}`,
      value: suggestion,
    })),
  );

  if (spotify !== undefined && spotifySuggestionPromise !== undefined) {
    const spotifyResult = await spotifySuggestionPromise;

    if ('error' in spotifyResult) {
      debug('Spotify autocomplete suggestions failed: %O', spotifyResult.error);
      throw new SpotifySuggestionsUnavailableError(suggestions, spotifyResult.error);
    }

    const spotifyResponse = spotifyResult.response.body;
    const spotifyAlbums = filterDuplicates(spotifyResponse.albums?.items ?? []);
    const spotifyTracks = filterDuplicates(spotifyResponse.tracks?.items ?? []);

    const totalSpotifyResults = spotifyAlbums.length + spotifyTracks.length;

    const maxSpotifySuggestions = Math.floor(limit / 2);
    const numOfSpotifySuggestions = Math.min(maxSpotifySuggestions, totalSpotifyResults);

    const preferredSpotifyAlbums = Math.floor(numOfSpotifySuggestions / 2);
    let numOfSpotifyAlbums = Math.min(preferredSpotifyAlbums, spotifyAlbums.length);
    const numOfSpotifyTracks = Math.min(numOfSpotifySuggestions - numOfSpotifyAlbums, spotifyTracks.length);
    numOfSpotifyAlbums = Math.min(spotifyAlbums.length, numOfSpotifySuggestions - numOfSpotifyTracks);

    const selectedSpotifyAlbums = spotifyAlbums.slice(0, numOfSpotifyAlbums);
    const selectedSpotifyTracks = spotifyTracks.slice(0, numOfSpotifyTracks);
    const actualSpotifySuggestions = selectedSpotifyAlbums.length + selectedSpotifyTracks.length;

    const maxYouTubeSuggestions = limit - actualSpotifySuggestions;
    suggestions = suggestions.slice(0, maxYouTubeSuggestions);

    suggestions.push(
      ...selectedSpotifyAlbums.map((album) => ({
        name: `${spotifyAlbumIcon} ${album.name}${album.artists.length > 0 ? ` - ${album.artists[0].name}` : ''}`,
        value: `spotify:album:${album.id}`,
      })),
    );

    suggestions.push(
      ...selectedSpotifyTracks.map((track) => ({
        name: `${spotifyTrackIcon} ${track.name}${track.artists.length > 0 ? ` - ${track.artists[0].name}` : ''}`,
        value: `spotify:track:${track.id}`,
      })),
    );
  }

  return suggestions;
};

export default getYouTubeAndSpotifySuggestionsFor;
