import getYouTubeID from 'get-youtube-id';
import { parse, toSeconds } from 'iso8601-duration';
import { ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS } from '../utils/constants.js';
import { parseTime } from '../utils/time.js';
import { buildAudioFallbackQuery, rankAudioFallbackCandidates } from '../utils/youtubeAudioFallback.js';
import type Config from './config.js';
import type KeyValueCacheProvider from './keyValueCache.js';
import { MediaSource, type QueuedPlaylist, type SongMetadata } from './player.js';

interface VideoDetailsResponse {
  id: string;
  contentDetails: {
    videoId: string;
    duration: string;
    contentRating?: {
      ytRating?: string;
    };
  };
  snippet: {
    title: string;
    channelTitle: string;
    liveBroadcastContent: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
  };
}

interface PlaylistResponse {
  id: string;
  contentDetails: {
    itemCount: number;
  };
  snippet: {
    title: string;
  };
}

interface PlaylistItemsResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
}

interface PlaylistItem {
  id: string;
  contentDetails: {
    videoId: string;
  };
}

interface SearchResponse {
  items: SearchItem[];
}

interface SearchItem {
  id: {
    videoId: string;
  };
}

export default class YoutubeAPI {
  private readonly youtubeKey: string;
  private readonly cache: KeyValueCacheProvider;
  private readonly baseUrl = 'https://www.googleapis.com/youtube/v3/';

  constructor(config: Config, cache: KeyValueCacheProvider) {
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.cache = cache;
  }

  private async apiCall<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set('key', this.youtubeKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`YouTube API request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async search(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const ids = await this.searchVideoIDs(query);

    if (ids.length === 0) {
      return [];
    }

    const videos = await this.getVideosByID(ids);
    const firstVideo = ids.map((id) => videos.find((video) => video.id === id)).find(Boolean);

    return firstVideo ? this.getMetadataFromVideo({ video: firstVideo, shouldSplitChapters }) : [];
  }

  async findAudioFallback(song: SongMetadata): Promise<SongMetadata | null> {
    if (song.source !== MediaSource.Youtube || song.isLive) {
      return null;
    }

    const query = buildAudioFallbackQuery(song);
    if (!query) {
      return null;
    }

    const ids = (await this.searchVideoIDs(query, { videoCategoryId: '10' })).filter((id) => id !== song.url);
    if (ids.length === 0) {
      return null;
    }

    const videos = await this.getVideosByID(ids);
    const candidates = ids
      .map((id) => videos.find((video) => video.id === id))
      .filter(
        (video): video is VideoDetailsResponse =>
          Boolean(video) && video!.contentDetails.contentRating?.ytRating !== 'ytAgeRestricted',
      )
      .flatMap((video) => this.getMetadataFromVideo({ video, shouldSplitChapters: false }));

    return rankAudioFallbackCandidates(song, candidates).at(0) ?? null;
  }

  async getVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const videoId = url.length === 11 ? url : getYouTubeID(url);

    if (!videoId) {
      throw new Error('Video could not be found.');
    }

    const result = await this.getVideosByID([videoId]);
    const video = result.at(0);

    if (!video) {
      throw new Error('Video could not be found.');
    }

    return this.getMetadataFromVideo({ video, shouldSplitChapters });
  }

  async getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const playlistParams = {
      part: 'id, snippet, contentDetails',
      id: listId,
    };
    const cacheParams = { searchParams: playlistParams };
    const { items: playlists } = await this.cache.wrap(
      async () => this.apiCall<{ items: PlaylistResponse[] }>('playlists', playlistParams),
      cacheParams,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const playlist = playlists.at(0)!;

    if (!playlist) {
      throw new Error('Playlist could not be found.');
    }

    const playlistVideos: PlaylistItem[] = [];
    const videoDetailsPromises: Array<Promise<void>> = [];
    const videoDetails: VideoDetailsResponse[] = [];
    const requestedPageTokens = new Set<string>();

    let nextToken: string | undefined;

    do {
      if (nextToken) {
        requestedPageTokens.add(nextToken);
      }

      const playlistItemsParams = {
        part: 'id, contentDetails',
        playlistId: listId,
        maxResults: '50',
        pageToken: nextToken,
      };
      const cacheItemsParams = { searchParams: playlistItemsParams };

      const { items, nextPageToken } = await this.cache.wrap(
        async () => this.apiCall<PlaylistItemsResponse>('playlistItems', playlistItemsParams),
        cacheItemsParams,
        {
          expiresIn: ONE_MINUTE_IN_SECONDS,
        },
      );

      nextToken = nextPageToken;
      playlistVideos.push(...items);

      if (items.length > 0) {
        videoDetailsPromises.push(
          (async () => {
            const videoDetailItems = await this.getVideosByID(items.map((item) => item.contentDetails.videoId));
            videoDetails.push(...videoDetailItems);
          })(),
        );
      }
    } while (nextToken && !requestedPageTokens.has(nextToken));

    await Promise.all(videoDetailsPromises);

    const queuedPlaylist = { title: playlist.snippet.title, source: playlist.id };

    const songsToReturn: SongMetadata[] = [];

    for (const video of playlistVideos) {
      try {
        songsToReturn.push(
          ...this.getMetadataFromVideo({
            video: videoDetails.find((i: { id: string }) => i.id === video.contentDetails.videoId)!,
            queuedPlaylist,
            shouldSplitChapters,
          }),
        );
      } catch (_: unknown) {}
    }

    return songsToReturn;
  }

  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    shouldSplitChapters,
  }: {
    video: VideoDetailsResponse;
    queuedPlaylist?: QueuedPlaylist;
    shouldSplitChapters?: boolean;
  }): SongMetadata[] {
    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: toSeconds(parse(video.contentDetails.duration)),
      offset: 0,
      url: video.id,
      playlist: queuedPlaylist ?? null,
      isLive: video.snippet.liveBroadcastContent === 'live',
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!shouldSplitChapters) {
      return [base];
    }

    const chapters = this.parseChaptersFromDescription(video.snippet.description, base.length);

    if (!chapters) {
      return [base];
    }

    const tracks: SongMetadata[] = [];

    for (const [label, { offset, length }] of chapters) {
      tracks.push({
        ...base,
        offset,
        length,
        title: `${label} (${base.title})`,
      });
    }

    return tracks;
  }

  private parseChaptersFromDescription(description: string, videoDurationSeconds: number) {
    const chapters: Array<[string, { offset: number; length: number }]> = [];
    let foundFirstTimestamp = false;

    const foundTimestamps: Array<{ name: string; offset: number }> = [];
    for (const line of description.split('\n')) {
      const timestamps = Array.from(line.matchAll(/(?:\d+:)+\d+/g));
      if (timestamps?.length !== 1) {
        continue;
      }

      if (!foundFirstTimestamp) {
        if (/^0+(?::0+)+$/u.test(timestamps[0][0])) {
          foundFirstTimestamp = true;
        } else {
          continue;
        }
      }

      const timestamp = timestamps[0][0];
      const seconds = parseTime(timestamp);
      const chapterName = line.split(timestamp)[1].trim();

      foundTimestamps.push({ name: chapterName, offset: seconds });
    }

    const hasInvalidChapter = foundTimestamps.some(
      ({ name, offset }, index) =>
        !name || offset >= videoDurationSeconds || (index > 0 && offset <= foundTimestamps[index - 1].offset),
    );

    if (foundTimestamps.length === 0 || hasInvalidChapter) {
      return null;
    }

    for (const [i, { name, offset }] of foundTimestamps.entries()) {
      chapters.push([
        name,
        {
          offset,
          length:
            i === foundTimestamps.length - 1 ? videoDurationSeconds - offset : foundTimestamps[i + 1].offset - offset,
        },
      ]);
    }

    return chapters;
  }

  private async searchVideoIDs(query: string, options: { videoCategoryId?: string } = {}): Promise<string[]> {
    const searchParams: Record<string, string | undefined> = {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '10',
    };

    if (options.videoCategoryId) {
      searchParams.videoCategoryId = options.videoCategoryId;
    }

    const cacheParams = { searchParams };
    const { items } = await this.cache.wrap(
      async () => this.apiCall<SearchResponse>('search', searchParams),
      cacheParams,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    return items.map((item) => item.id.videoId).filter(Boolean);
  }

  private async getVideosByID(videoIDs: string[]): Promise<VideoDetailsResponse[]> {
    const searchParams: Record<string, string | undefined> = {
      part: 'id, snippet, contentDetails',
      id: videoIDs.join(','),
    };
    const cacheParams = { searchParams };

    const { items: videos } = await this.cache.wrap(
      async () => this.apiCall<{ items: VideoDetailsResponse[] }>('videos', searchParams),
      cacheParams,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );
    return videos;
  }
}
