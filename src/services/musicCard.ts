import { Bloom, type BloomOptions, initializeFonts } from 'musicard';
import debug from '../utils/debug.js';
import type { EnrichedTrackMetadata } from './musicMetadata.js';
import type Player from './player.js';
import { STATUS } from './player.js';

let fontsInitialized = false;

const ensureFonts = (): void => {
  if (!fontsInitialized) {
    initializeFonts();
    fontsInitialized = true;
  }
};

const FALLBACK_ART = 'https://via.placeholder.com/600x600/1a1a2e/9b6cf6?text=♪';

export interface MusicCardInput {
  trackName: string;
  artistName: string;
  albumArt: string | Buffer | null;
  duration: number;
  position: number;
  isExplicit: boolean;
  isPaused: boolean;
}

export interface MusicCardResult {
  buffer: Buffer;
}

const clampProgress = (position: number, duration: number): number => {
  if (duration <= 0 || !Number.isFinite(duration)) {
    return 0;
  }
  const raw = position / duration;
  if (!Number.isFinite(raw) || Number.isNaN(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const truncateName = (name: string, max = 30): string => {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 3)}...`;
};

const canRenderCard = (meta: EnrichedTrackMetadata): boolean => {
  if (meta.isLive) {
    return true;
  }
  return meta.duration > 0 && Number.isFinite(meta.duration);
};

export default class MusicCardService {
  private readonly cache = new Map<string, MusicCardResult>();

  async generate(input: MusicCardInput): Promise<MusicCardResult> {
    ensureFonts();

    const resolvedArt = await this.resolveArtwork(input.albumArt);
    const progress = clampProgress(input.position, input.duration);
    const trackName = truncateName(input.trackName);
    const artistName = truncateName(input.artistName);

    const bloomOptions: BloomOptions = {
      albumArt: resolvedArt,
      fallbackArt: FALLBACK_ART,
      artistName,
      trackName,
      progressBar: progress,
      timeAdjust: {
        timeStart: formatTime(input.position),
        timeEnd: formatTime(input.duration),
      },
      isExplicit: input.isExplicit,
      backgroundColor: 'black',
      styleConfig: {
        artistStyle: {
          textColor: '#b8b8d4',
          textItalic: false,
          textGlow: false,
        },
        trackStyle: {
          textColor: '#ffffff',
          textItalic: false,
          textGlow: true,
        },
        timeStyle: {
          textColor: '#a0a0c0',
          textItalic: false,
        },
        progressBarStyle: {
          barColor: '#9b6cf6',
          barColorDuo: true,
        },
        explicitStyle: {
          iconColor: '#ff4444',
          iconOpacity: 80,
        },
      },
    };

    const buffer = await Bloom(bloomOptions);
    return { buffer };
  }

  async generateSafe(input: MusicCardInput): Promise<MusicCardResult | null> {
    try {
      return await this.generate(input);
    } catch (error) {
      debug(`Music card generation failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getOrGenerateForPlayer(player: Player, meta: EnrichedTrackMetadata): Promise<MusicCardResult | null> {
    if (!canRenderCard(meta)) {
      return null;
    }

    const song = player.getCurrent();
    if (!song) {
      return null;
    }

    const progress = Math.floor(player.getPosition() / 30) * 30;
    const cacheKey = [
      player.guildId,
      song.url,
      song.offset,
      meta.artworkUrl ?? '',
      meta.explicit === true ? 'explicit' : 'clean',
      player.status,
      progress,
    ].join('|');

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.generateSafe({
      trackName: meta.title,
      artistName: meta.artist,
      albumArt: meta.artworkUrl ?? null,
      duration: meta.duration,
      position: player.getPosition(),
      isExplicit: meta.explicit === true,
      isPaused: player.status === STATUS.PAUSED,
    });

    if (result) {
      this.cache.set(cacheKey, result);
      this.trimCache();
    }

    return result;
  }

  private async resolveArtwork(artwork: string | Buffer | null): Promise<string | Buffer> {
    if (!artwork) {
      return FALLBACK_ART;
    }

    if (Buffer.isBuffer(artwork)) {
      return artwork;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(artwork, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        debug(`Artwork fetch failed (${response.status}): ${artwork}`);
        return FALLBACK_ART;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
        debug(`Artwork not an image (${contentType}): ${artwork}`);
        return FALLBACK_ART;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        debug(`Artwork empty: ${artwork}`);
        return FALLBACK_ART;
      }

      return buffer;
    } catch (error) {
      debug(`Artwork fetch error: ${error instanceof Error ? error.message : String(error)}`);
      return FALLBACK_ART;
    }
  }

  private trimCache(): void {
    if (this.cache.size > 64) {
      const keys = [...this.cache.keys()];
      for (const key of keys.slice(0, keys.length - 48)) {
        this.cache.delete(key);
      }
    }
  }
}
