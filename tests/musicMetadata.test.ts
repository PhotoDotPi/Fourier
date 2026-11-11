import { describe, expect, it, vi } from 'bun:test';
import type ItunesSearchService from '../src/services/itunesSearch.js';
import type { ItunesEnrichedMetadata } from '../src/services/itunesSearch.js';
import { resolveEnrichedMetadata } from '../src/services/musicMetadata.js';
import { MediaSource, type QueuedSong } from '../src/services/player.js';

const makeSong = (overrides: Partial<QueuedSong> = {}): QueuedSong => ({
  title: 'Test track',
  artist: 'Test artist',
  url: 'video-id',
  length: 180,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: 'https://img.example/video.jpg',
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
  ...overrides,
});

const makeItunesMeta = (overrides: Partial<ItunesEnrichedMetadata> = {}): ItunesEnrichedMetadata => ({
  itunesId: 'itunes-id',
  album: 'iTunes album',
  artworkUrl: 'https://itunes.example/600x600bb.jpg',
  explicit: true,
  releaseDate: '2024-01-15',
  genre: 'Pop',
  isrc: 'USRC17600000',
  appleMusicUrl: 'https://music.apple.com/track',
  previewUrl: 'https://audio.example/preview.m4a',
  trackNumber: 3,
  discNumber: 1,
  ...overrides,
});

const makeItunesSearch = (result: ItunesEnrichedMetadata | null): ItunesSearchService =>
  ({ lookupByTitle: vi.fn().mockResolvedValue(result) }) as unknown as ItunesSearchService;

describe('resolveEnrichedMetadata fallback hierarchy', () => {
  it('prefers iTunes artwork and metadata over the YouTube thumbnail', async () => {
    const itunes = makeItunesSearch(makeItunesMeta());

    const meta = await resolveEnrichedMetadata(makeSong(), 42, itunes);

    expect(meta.artworkUrl).toBe('https://itunes.example/600x600bb.jpg');
    expect(meta.album).toBe('iTunes album');
    expect(meta.explicit).toBe(true);
    expect(meta.genre).toBe('Pop');
    expect(meta.releaseDate).toBe('2024-01-15');
    expect(meta.position).toBe(42);
    expect(meta.duration).toBe(180);
    expect(meta.isLive).toBe(false);
  });

  it('falls back to the YouTube thumbnail and no explicit tag when iTunes has nothing', async () => {
    const meta = await resolveEnrichedMetadata(makeSong(), 0, makeItunesSearch(null));

    expect(meta.artworkUrl).toBe('https://img.example/video.jpg');
    expect(meta.explicit).toBeUndefined();
    expect(meta.album).toBeUndefined();
  });

  it('keeps an explicit non-explicit match distinct from an unknown explicitness', async () => {
    const cleaned = await resolveEnrichedMetadata(makeSong(), 0, makeItunesSearch(makeItunesMeta({ explicit: false })));
    const unknown = await resolveEnrichedMetadata(
      makeSong(),
      0,
      makeItunesSearch(makeItunesMeta({ explicit: undefined })),
    );

    expect(cleaned.explicit).toBe(false);
    expect(unknown.explicit).toBeUndefined();
  });

  it('still resolves without any iTunes service at all', async () => {
    const meta = await resolveEnrichedMetadata(makeSong(), 12, null);

    expect(meta.artworkUrl).toBe('https://img.example/video.jpg');
    expect(meta.explicit).toBeUndefined();
    expect(meta.album).toBeUndefined();
    expect(meta.position).toBe(12);
  });

  it('survives iTunes failures and treats them as a miss', async () => {
    const itunes = {
      lookupByTitle: vi.fn().mockRejectedValue(new Error('iTunes down')),
    } as unknown as ItunesSearchService;

    const meta = await resolveEnrichedMetadata(makeSong(), 5, itunes);

    expect(meta.artworkUrl).toBe('https://img.example/video.jpg');
    expect(meta.explicit).toBeUndefined();
  });

  it('omits artwork entirely when neither source has one', async () => {
    const meta = await resolveEnrichedMetadata(makeSong({ thumbnailUrl: null }), 0, null);

    expect(meta.artworkUrl).toBeUndefined();
  });

  it('carries through live and HLS source flags', async () => {
    const liveHls = await resolveEnrichedMetadata(
      makeSong({ isLive: true, source: MediaSource.HLS, thumbnailUrl: null }),
      0,
      null,
    );

    expect(liveHls.isLive).toBe(true);
    expect(liveHls.source).toBe(MediaSource.HLS);
    expect(liveHls.artworkUrl).toBeUndefined();
  });
});
