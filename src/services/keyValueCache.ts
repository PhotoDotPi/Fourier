import * as kvRepo from '../db/repositories/keyValueCache.js';
import debug from '../utils/debug.js';

type Seconds = number;

type Options = {
  expiresIn: Seconds;
  key?: string;
};

const futureTimeToDate = (time: Seconds) => new Date(Date.now() + time * 1000);

export default class KeyValueCacheProvider {
  async wrap<T extends [...unknown[], Options], F>(func: (...options: T) => Promise<F>, ...options: T): Promise<F> {
    if (options.length === 0) {
      throw new Error('Missing cache options');
    }

    const functionArgs = options.slice(0, options.length - 1);

    const { key = JSON.stringify(functionArgs), expiresIn } = options[options.length - 1] as Options;

    if (key.length < 4) {
      throw new Error(`Cache key ${key} is too short.`);
    }

    const cachedResult = await kvRepo.findByKey(key);

    if (cachedResult) {
      if (new Date() < cachedResult.expiresAt) {
        debug(`Cache hit: ${key}`);
        return JSON.parse(cachedResult.value) as F;
      }

      await kvRepo.deleteByKey(key);
    }

    debug(`Cache miss: ${key}`);

    const result = await func(...options);

    const value = JSON.stringify(result);
    const expiresAt = futureTimeToDate(expiresIn);
    await kvRepo.upsertKeyValue(key, value, expiresAt);

    return result;
  }

  async get<T>(key: string): Promise<T | null> {
    const cachedResult = await kvRepo.findByKey(key);

    if (!cachedResult) {
      return null;
    }

    if (new Date() >= cachedResult.expiresAt) {
      await kvRepo.deleteByKey(key);
      return null;
    }

    return JSON.parse(cachedResult.value) as T;
  }

  async set<T>(key: string, value: T, expiresIn: Seconds): Promise<void> {
    await kvRepo.upsertKeyValue(key, JSON.stringify(value), futureTimeToDate(expiresIn));
  }
}
