import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ActivityType, type PresenceStatusData } from 'discord.js';
import { firstNonEmpty } from '../utils/string.js';

const stripQuotes = (value: string): string => {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));

  return quoted ? value.slice(1, -1) : value;
};

const parseEnvLine = (rawLine: string): [string, string] | undefined => {
  const line = rawLine.trim();

  if (!line || line.startsWith('#')) {
    return undefined;
  }

  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) {
    return undefined;
  }

  const key = line.slice(0, eqIndex).trim();
  const value = line.slice(eqIndex + 1).trim();

  return [key, stripQuotes(value).replace(/\\n/g, '\n')];
};

const loadEnvFile = (envFilePath: string): void => {
  try {
    const content = readFileSync(envFilePath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const entry = parseEnvLine(rawLine);

      if (entry && process.env[entry[0]] === undefined) {
        process.env[entry[0]] = entry[1];
      }
    }
  } catch {}
};

const envFilePath = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
loadEnvFile(envFilePath);

const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');

const parseSize = (input: string): number => {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(-?[\d.]+)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) {
    return Number.NaN;
  }
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multipliers: Record<string, number> = { b: 1, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4 };
  return Math.floor(value * (multipliers[unit] ?? 1));
};

const CONFIG_MAP = {
  DISCORD_TOKEN: firstNonEmpty(process.env.DISCORD_TOKEN),
  YOUTUBE_API_KEY: firstNonEmpty(process.env.YOUTUBE_API_KEY),
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  REGISTER_COMMANDS_ON_BOT: process.env.REGISTER_COMMANDS_ON_BOT === 'true',
  DATA_DIR,
  CACHE_DIR: path.join(DATA_DIR, 'cache'),
  CACHE_LIMIT_IN_BYTES: parseSize(process.env.CACHE_LIMIT ?? '2GB'),
  BOT_STATUS: process.env.BOT_STATUS ?? 'online',
  BOT_ACTIVITY_TYPE: process.env.BOT_ACTIVITY_TYPE ?? 'LISTENING',
  BOT_ACTIVITY_URL: process.env.BOT_ACTIVITY_URL ?? '',
  BOT_ACTIVITY: process.env.BOT_ACTIVITY ?? 'music',
  ENABLE_SPONSORBLOCK: process.env.ENABLE_SPONSORBLOCK === 'true',
  SPONSORBLOCK_TIMEOUT: parseInt(process.env.SPONSORBLOCK_TIMEOUT ?? '5', 10),
  YT_DLP_PATH:
    firstNonEmpty(process.env.YT_DLP_PATH, process.env.FOURIER_BUNDLED_YT_DLP_PATH) ??
    path.join(process.cwd(), 'bin', 'yt-dlp'),
  YT_DLP_AUTO_UPDATE: process.env.YT_DLP_AUTO_UPDATE === 'true',
} as const;

const BOT_ACTIVITY_TYPE_MAP = {
  PLAYING: ActivityType.Playing,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  STREAMING: ActivityType.Streaming,
} as const;

const resolveNumericValue = (key: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${key}`);
  }

  if (key === 'CACHE_LIMIT_IN_BYTES' && value < 0) {
    throw new Error('Invalid numeric value for CACHE_LIMIT_IN_BYTES: value must be non-negative');
  }

  return value;
};

const assignConfigValue = (key: string, value: unknown): unknown => {
  if (typeof value === 'undefined') {
    console.error(`Missing environment variable for ${key}`);
    process.exit(1);
  }

  if (key === 'BOT_ACTIVITY_TYPE') {
    return BOT_ACTIVITY_TYPE_MAP[(value as string).toUpperCase() as keyof typeof BOT_ACTIVITY_TYPE_MAP];
  }

  if (typeof value === 'number') {
    return resolveNumericValue(key, value);
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`Unsupported type for ${key}`);
};

export default class Config {
  readonly DISCORD_TOKEN!: string;
  readonly YOUTUBE_API_KEY!: string;
  readonly SPOTIFY_CLIENT_ID!: string;
  readonly SPOTIFY_CLIENT_SECRET!: string;
  readonly REGISTER_COMMANDS_ON_BOT!: boolean;
  readonly DATA_DIR!: string;
  readonly CACHE_DIR!: string;
  readonly CACHE_LIMIT_IN_BYTES!: number;
  readonly BOT_STATUS!: PresenceStatusData;
  readonly BOT_ACTIVITY_TYPE!: Exclude<ActivityType, ActivityType.Custom>;
  readonly BOT_ACTIVITY_URL!: string;
  readonly BOT_ACTIVITY!: string;
  readonly ENABLE_SPONSORBLOCK!: boolean;
  readonly SPONSORBLOCK_TIMEOUT!: number;
  readonly YT_DLP_PATH!: string;
  readonly YT_DLP_AUTO_UPDATE!: boolean;

  constructor() {
    const config = this as unknown as Record<string, unknown>;

    for (const [key, value] of Object.entries(CONFIG_MAP)) {
      config[key] = assignConfigValue(key, value);
    }
  }
}
