import { URL } from 'node:url';
import * as spotifyURI from 'spotify-uri';
import { ffprobe } from './ffmpegProcess.js';
import { MediaSource, type QueuedPlaylist, type SongMetadata } from './player.js';
import type SpotifyAPI from './spotifyApi.js';
import type { SpotifyTrack } from './spotifyApi.js';
import type YoutubeAPI from './youtubeApi.js';

const SUPPORTED_PROTOCOLS = ['http:', 'https:', 'spotify:'];
const YOUTUBE_HOSTS = ['www.youtube.com', 'youtu.be', 'youtube.com', 'music.youtube.com', 'www.music.youtube.com'];

const parseUrl = (query: string): URL | undefined => {
  try {
    return new URL(query);
  } catch (_: unknown) {
    return undefined;
  }
};

const buildSpotifyExtraMessage = (totalSongs: number, playlistLimit: number, nSongsNotFound: number): string => {
  const messages: string[] = [];

  if (totalSongs > playlistLimit) {
    messages.push(`a random sample of ${playlistLimit} songs was taken`);
  }

  if (nSongsNotFound === 1) {
    messages.push('1 song was not found');
  } else if (nSongsNotFound !== 0) {
    messages.push(`${nSongsNotFound.toString()} songs were not found`);
  }

  return messages.join(' and ');
};

export default class GetSongs {
  private readonly youtubeAPI: YoutubeAPI;
  private readonly spotifyAPI?: SpotifyAPI;

  constructor(youtubeAPI: YoutubeAPI, spotifyAPI?: SpotifyAPI) {
    this.youtubeAPI = youtubeAPI;
    this.spotifyAPI = spotifyAPI;
  }

  async getSongs(
    query: string,
    playlistLimit: number,
    shouldSplitChapters: boolean,
  ): Promise<[SongMetadata[], string]> {
    const url = parseUrl(query);

    if (!url || !SUPPORTED_PROTOCOLS.includes(url.protocol)) {
      return [await this.songsFromSearch(query, shouldSplitChapters), ''];
    }

    if (YOUTUBE_HOSTS.includes(url.host)) {
      return [await this.songsFromYoutube(url, playlistLimit, shouldSplitChapters), ''];
    }

    if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
      return this.songsFromSpotify(query, playlistLimit, shouldSplitChapters);
    }

    return [[await this.httpLiveStreamOrThrow(query)], ''];
  }

  private async songsFromSearch(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const songs = await this.youtubeVideoSearch(query, shouldSplitChapters);

    if (!songs) {
      throw new Error("that doesn't exist");
    }

    return songs;
  }

  private async songsFromYoutube(
    url: URL,
    playlistLimit: number,
    shouldSplitChapters: boolean,
  ): Promise<SongMetadata[]> {
    const listId = url.searchParams.get('list');

    if (listId) {
      return (await this.youtubePlaylist(listId, shouldSplitChapters)).slice(0, playlistLimit);
    }

    const songs = await this.youtubeVideo(url.href, shouldSplitChapters);

    if (!songs) {
      throw new Error("that doesn't exist");
    }

    return songs;
  }

  private async songsFromSpotify(
    query: string,
    playlistLimit: number,
    shouldSplitChapters: boolean,
  ): Promise<[SongMetadata[], string]> {
    if (this.spotifyAPI === undefined) {
      throw new Error('Spotify is not enabled!');
    }

    const [convertedSongs, nSongsNotFound, totalSongs] = await this.spotifySource(
      query,
      playlistLimit,
      shouldSplitChapters,
    );

    return [convertedSongs, buildSpotifyExtraMessage(totalSongs, playlistLimit, nSongsNotFound)];
  }

  private async httpLiveStreamOrThrow(url: string): Promise<SongMetadata> {
    const song = await this.httpLiveStream(url);

    if (!song) {
      throw new Error("that doesn't exist");
    }

    return song;
  }

  private async youtubeVideoSearch(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.search(query, shouldSplitChapters);
  }

  private async youtubeVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getVideo(url, shouldSplitChapters);
  }

  private async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getPlaylist(listId, shouldSplitChapters);
  }

  private async spotifySource(
    url: string,
    playlistLimit: number,
    shouldSplitChapters: boolean,
  ): Promise<[SongMetadata[], number, number]> {
    if (this.spotifyAPI === undefined) {
      return [[], 0, 0];
    }

    const parsed = spotifyURI.parse(url);

    switch (parsed.type) {
      case 'album': {
        const [tracks, playlist] = await this.spotifyAPI.getAlbum(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'playlist': {
        const [tracks, playlist] = await this.spotifyAPI.getPlaylist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'track': {
        const tracks = [await this.spotifyAPI.getTrack(url)];
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      case 'artist': {
        const tracks = await this.spotifyAPI.getArtist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      default: {
        return [[], 0, 0];
      }
    }
  }

  private async httpLiveStream(url: string): Promise<SongMetadata> {
    await ffprobe(url);

    return {
      url,
      source: MediaSource.HLS,
      isLive: true,
      title: url,
      artist: url,
      length: 0,
      offset: 0,
      playlist: null,
      thumbnailUrl: null,
    };
  }

  private async spotifyToYouTube(
    tracks: SpotifyTrack[],
    shouldSplitChapters: boolean,
    playlist?: QueuedPlaylist | undefined,
  ): Promise<[SongMetadata[], number, number]> {
    const promisedResults = tracks.map(async (track) =>
      this.youtubeAPI.search(`"${track.name}" "${track.artist}"`, shouldSplitChapters),
    );
    const searchResults = await Promise.allSettled(promisedResults);

    let nSongsNotFound = 0;

    const songs: SongMetadata[] = searchResults.reduce((accum: SongMetadata[], result) => {
      if (result.status === 'fulfilled') {
        if (result.value.length === 0) {
          nSongsNotFound++;
        }

        for (const v of result.value) {
          accum.push({
            ...v,
            ...(playlist ? { playlist } : {}),
          });
        }
      } else {
        nSongsNotFound++;
      }

      return accum;
    }, []);

    return [songs, nSongsNotFound, tracks.length];
  }
}
