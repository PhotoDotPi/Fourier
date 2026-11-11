import debug from '../utils/debug.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface ItunesCatalogTrack {
  id: string;
  name: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  explicit: boolean | null;
  releaseDate: string | null;
  genre: string | null;
  isrc: string | null;
  appleMusicUrl: string | null;
  previewUrl: string | null;
  length: number;
  trackNumber: number | null;
  discNumber: number | null;
}

export interface ItunesEnrichedMetadata {
  itunesId: string;
  trackName?: string;
  artistName?: string;
  album?: string;
  artworkUrl?: string;
  explicit?: boolean;
  releaseDate?: string;
  genre?: string;
  isrc?: string;
  appleMusicUrl?: string;
  previewUrl?: string;
  trackNumber?: number;
  discNumber?: number;
}

const normalizeExplicit = (value: string): boolean | null => {
  if (value === 'explicit') {
    return true;
  }
  if (value === 'notExplicit' || value === 'cleaned') {
    return false;
  }
  return null;
};

const resizeArtwork = (url: string | null | undefined): string | null => {
  if (!url) {
    return null;
  }
  return url.replace(/\/\d+x\d+bb(?=\.[a-zA-Z]+(?:$|\?))/u, '/600x600bb');
};

const toCatalogTrack = (result: Record<string, unknown>): ItunesCatalogTrack => ({
  id: String(result.trackId ?? ''),
  name: String(result.trackName ?? ''),
  artist: String(result.artistName ?? ''),
  album: (result.collectionName as string) ?? null,
  artworkUrl: resizeArtwork(result.artworkUrl100 as string | undefined),
  explicit: normalizeExplicit(result.trackExplicitness as string),
  releaseDate: (result.releaseDate as string)?.slice(0, 10) ?? null,
  genre: (result.primaryGenreName as string) ?? null,
  isrc: (result.isrc as string) ?? null,
  appleMusicUrl: (result.trackViewUrl as string) ?? null,
  previewUrl: (result.previewUrl as string) ?? null,
  length: Math.round(((result.trackTimeMillis as number) ?? 0) / 1000),
  trackNumber: (result.trackNumber as number) ?? null,
  discNumber: (result.discNumber as number) ?? null,
});

const toCatalogMetadata = (catalog: ItunesCatalogTrack): ItunesEnrichedMetadata => ({
  itunesId: catalog.id,
  trackName: catalog.name === '' ? undefined : catalog.name,
  artistName: catalog.artist === '' ? undefined : catalog.artist,
  album: catalog.album ?? undefined,
  artworkUrl: catalog.artworkUrl ?? undefined,
  explicit: catalog.explicit ?? undefined,
  releaseDate: catalog.releaseDate ?? undefined,
  genre: catalog.genre ?? undefined,
  isrc: catalog.isrc ?? undefined,
  appleMusicUrl: catalog.appleMusicUrl ?? undefined,
  previewUrl: catalog.previewUrl ?? undefined,
  trackNumber: catalog.trackNumber ?? undefined,
  discNumber: catalog.discNumber ?? undefined,
});

interface CacheEntry {
  value: ItunesEnrichedMetadata[];
  expiresAt: number;
}

export default class ItunesSearchService {
  private readonly baseUrl = 'https://itunes.apple.com/';
  private readonly cache = new Map<string, CacheEntry>();

  async search(query: string, limit = 10): Promise<ItunesEnrichedMetadata[]> {
    const url = new URL('search', this.baseUrl);
    url.searchParams.set('media', 'music');
    url.searchParams.set('term', query);
    url.searchParams.set('limit', String(limit));

    const results = await this.cachedResults(url);
    return results;
  }

  async getTrack(id: string): Promise<ItunesEnrichedMetadata | null> {
    const url = new URL('lookup', this.baseUrl);
    url.searchParams.set('id', id);

    const results = await this.cachedResults(url);
    return results.at(0) ?? null;
  }

  async lookupByTitle(title: string, artist: string): Promise<ItunesEnrichedMetadata | null> {
    const query = `${title} ${artist}`.trim();
    const results = await this.search(query, 5);

    const titleLower = title
      .toLowerCase()
      .replace(/[[\]()]/g, '')
      .trim();
    const best = results.find((r) => {
      const trackName = (r.trackName ?? '')
        .toLowerCase()
        .replace(/[[\]()]/g, '')
        .trim();
      return trackName !== '' && (trackName.includes(titleLower) || titleLower.includes(trackName));
    });

    return best ?? null;
  }

  private async cachedResults(url: URL): Promise<ItunesEnrichedMetadata[]> {
    const key = url.searchParams.toString();
    const existing = this.cache.get(key);
    if (existing && Date.now() < existing.expiresAt) {
      return existing.value;
    }

    const rawResults = await this.fetchResults(url);
    const mapped = rawResults.map(toCatalogTrack).map(toCatalogMetadata);

    this.cache.set(key, { value: mapped, expiresAt: Date.now() + FIVE_MINUTES_MS });
    return mapped;
  }

  private async fetchResults(url: URL): Promise<Record<string, unknown>[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`iTunes API request failed (${response.status})`);
      }
      const data = (await response.json()) as { results: Record<string, unknown>[] };
      return data.results;
    } catch (error) {
      debug(`iTunes search failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
