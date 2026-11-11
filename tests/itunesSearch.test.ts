import { afterEach, describe, expect, it, vi } from 'bun:test';
import ItunesSearchService from '../src/services/itunesSearch.js';

const makeResultResponse = (results: Array<Record<string, unknown>>) =>
  new Response(JSON.stringify({ resultCount: results.length, results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const makeTrack = (overrides: Partial<Record<string, unknown>> = {}) => ({
  artistName: 'Test artist',
  collectionName: 'Test album',
  discNumber: 1,
  isrc: 'USRC17600000',
  previewUrl: 'https://audio.example/preview.m4a',
  primaryGenreName: 'Pop',
  releaseDate: '2024-01-15T08:00:00Z',
  trackId: 123,
  trackName: 'Test track',
  trackNumber: 3,
  trackTimeMillis: 183000,
  trackViewUrl: 'https://music.apple.com/track',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
  trackExplicitness: 'explicit',
  ...overrides,
});

type FetchHandler = (input: string | URL | Request) => Promise<Response>;

const withFetch = async <T>(server: FetchHandler, run: () => Promise<T>): Promise<T> => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('iTunes search service', () => {
  it('maps catalog fields, resizes artwork, and normalizes explicitness', async () => {
    const requests: string[] = [];
    const server: FetchHandler = async (input) => {
      requests.push(String(input));
      return makeResultResponse([makeTrack()]);
    };

    const service = new ItunesSearchService();
    const tracks = await withFetch(server, () => service.search('test track', 5));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      itunesId: '123',
      album: 'Test album',
      artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/600x600bb.jpg',
      explicit: true,
      releaseDate: '2024-01-15',
      genre: 'Pop',
      isrc: 'USRC17600000',
      appleMusicUrl: 'https://music.apple.com/track',
      previewUrl: 'https://audio.example/preview.m4a',
      trackNumber: 3,
      discNumber: 1,
    });
    expect(requests[0]).toBe('https://itunes.apple.com/search?media=music&term=test+track&limit=5');
  });

  it('normalizes cleaned and unknown explicitness values', async () => {
    const server: FetchHandler = async () =>
      makeResultResponse([
        makeTrack({ trackExplicitness: 'cleaned' }),
        makeTrack({ trackId: 456, trackExplicitness: 'unknown-value' }),
      ]);

    const service = new ItunesSearchService();
    const tracks = await withFetch(server, () => service.search('test', 5));

    expect(tracks[0].explicit).toBe(false);
    expect(tracks[1].explicit).toBeUndefined();
  });

  it('skips the network for cached lookups and caches by query', async () => {
    const server: FetchHandler = vi.fn(async () => makeResultResponse([makeTrack()]));

    const service = new ItunesSearchService();
    await withFetch(server, () => service.search('cached query', 3));
    await withFetch(server, () => service.search('cached query', 3));

    expect(server).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the API errors or is unreachable', async () => {
    const failing: FetchHandler = async () => new Response(null, { status: 500 });
    const throwing: FetchHandler = async () => {
      throw new Error('network down');
    };

    const service = new ItunesSearchService();
    const from500 = await withFetch(failing, () => service.search('query', 5));
    const fromThrow = await withFetch(throwing, () => service.search('query', 5));

    expect(from500).toEqual([]);
    expect(fromThrow).toEqual([]);
  });

  it('gets a single track by id through the lookup endpoint', async () => {
    const requests: string[] = [];
    const server: FetchHandler = async (input) => {
      requests.push(String(input));
      return makeResultResponse([makeTrack()]);
    };

    const service = new ItunesSearchService();
    const track = await withFetch(server, () => service.getTrack('123'));

    expect(requests[0]).toBe('https://itunes.apple.com/lookup?id=123');
    expect(track?.itunesId).toBe('123');
  });

  it('returns null from getTrack when the lookup has no results', async () => {
    const server: FetchHandler = async () => makeResultResponse([]);

    const service = new ItunesSearchService();
    const track = await withFetch(server, () => service.getTrack('missing'));

    expect(track).toBeNull();
  });

  it('prefers the best track-title match and returns null when nothing matches', async () => {
    let callCount = 0;
    const server: FetchHandler = async () => {
      callCount += 1;
      if (callCount === 1) {
        return makeResultResponse([
          makeTrack({ trackId: 1, trackName: 'Some Other Song' }),
          makeTrack({ trackId: 2, trackName: 'My Track' }),
        ]);
      }
      return makeResultResponse([makeTrack({ trackId: 1, trackName: 'Some Other Song' })]);
    };

    const service = new ItunesSearchService();
    const best = await withFetch(server, () => service.lookupByTitle('my track', 'some artist'));
    const fallback = await withFetch(server, () => service.lookupByTitle('no match anywhere', 'some artist'));

    expect(best?.itunesId).toBe('2');
    expect(fallback).toBeNull();
  });
});
