import type ItunesSearchService from './itunesSearch.js';
import type { ItunesEnrichedMetadata } from './itunesSearch.js';
import type { QueuedSong } from './playerTypes.js';

export interface EnrichedTrackMetadata {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  explicit?: boolean;
  duration: number;
  position: number;
  genre?: string;
  releaseDate?: string;
  isrc?: string;
  appleMusicUrl?: string;
  previewUrl?: string;
  trackNumber?: number;
  discNumber?: number;
  thumbnailUrl: string | null;
  isLive: boolean;
  source: QueuedSong['source'];
}

const isTruthy = <T>(value: T | undefined | null | false): value is T =>
  value !== undefined && value !== null && value !== false;

export const resolveEnrichedMetadata = async (
  song: QueuedSong,
  position: number,
  itunesSearch: ItunesSearchService | null,
): Promise<EnrichedTrackMetadata> => {
  let itunesMeta: ItunesEnrichedMetadata | null = null;

  if (itunesSearch && song.title && song.artist) {
    try {
      itunesMeta = await itunesSearch.lookupByTitle(song.title, song.artist);
    } catch {}
  }

  const artworkUrl = resolveArtworkUrl(itunesMeta, song.thumbnailUrl);
  const explicit = resolveExplicit(itunesMeta);

  return {
    title: song.title,
    artist: song.artist,
    album: itunesMeta?.album,
    artworkUrl,
    explicit,
    duration: song.length,
    position,
    genre: itunesMeta?.genre,
    releaseDate: itunesMeta?.releaseDate,
    isrc: itunesMeta?.isrc,
    appleMusicUrl: itunesMeta?.appleMusicUrl,
    previewUrl: itunesMeta?.previewUrl,
    trackNumber: itunesMeta?.trackNumber,
    discNumber: itunesMeta?.discNumber,
    thumbnailUrl: song.thumbnailUrl,
    isLive: song.isLive,
    source: song.source,
  };
};

const resolveArtworkUrl = (
  itunesMeta: ItunesEnrichedMetadata | null,
  youtubeThumbnail: string | null,
): string | undefined => {
  if (isTruthy(itunesMeta?.artworkUrl)) {
    return itunesMeta.artworkUrl;
  }
  if (youtubeThumbnail) {
    return youtubeThumbnail;
  }
  return undefined;
};

const resolveExplicit = (itunesMeta: ItunesEnrichedMetadata | null): boolean | undefined => {
  if (itunesMeta && typeof itunesMeta.explicit === 'boolean') {
    return itunesMeta.explicit;
  }
  return undefined;
};
