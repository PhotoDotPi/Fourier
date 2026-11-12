import { randomUUID } from 'node:crypto';
import { type BigIntStats, createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import * as fileCacheRepo from '../db/repositories/fileCache.js';
import type { FileCacheRow } from '../db/types.js';
import debug from '../utils/debug.js';
import type Config from './config.js';

export type FileCacheEntry = {
  generation: string;
  path: string;
};

export default class FileCacheProvider {
  private static readonly mutationQueue = new PQueue({ concurrency: 1 });
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async getEntryFor(hash: string): Promise<FileCacheEntry | null> {
    return (
      (await FileCacheProvider.mutationQueue.add(async () => {
        const model = await fileCacheRepo.findByHash(hash);

        if (!model) {
          return null;
        }

        const resolvedPath = path.join(this.config.CACHE_DIR, hash);
        let stats: BigIntStats;

        try {
          stats = await fs.stat(resolvedPath, { bigint: true });
        } catch (_: unknown) {
          await fileCacheRepo.deleteByHash(hash);
          return null;
        }

        await fileCacheRepo.updateAccessedAt(hash, new Date());

        return {
          generation: this.getFileGeneration(stats),
          path: resolvedPath,
        };
      })) ?? null
    );
  }

  createWriteStream(hash: string) {
    const tmpPath = path.join(this.config.CACHE_DIR, 'tmp', `${hash}.${randomUUID()}`);
    const finalPath = path.join(this.config.CACHE_DIR, hash);

    const stream = createWriteStream(tmpPath);
    let finished = false;
    let writeFailed = false;

    const handleWriteError = (error: unknown) => {
      writeFailed = true;
      this.reportWriteError(error);
    };

    stream.once('finish', () => {
      finished = true;
    });
    stream.once('error', handleWriteError);

    stream.once('close', () => {
      stream.removeListener('error', handleWriteError);

      const completion =
        finished && !writeFailed ? this.finalizeWrite(hash, tmpPath, finalPath) : this.removeTemporaryFile(tmpPath);

      void completion.catch((error) => {
        this.reportFinalizationError(stream, error);
      });
    });

    return stream;
  }

  async cleanup() {
    await FileCacheProvider.mutationQueue.add(async () => {
      await this.removeOrphans();
      await this.evictOldest();
    });
  }

  async invalidate(hash: string, expectedGeneration: string) {
    await FileCacheProvider.mutationQueue.add(async () => {
      const resolvedPath = path.join(this.config.CACHE_DIR, hash);
      try {
        const stats = await fs.stat(resolvedPath, { bigint: true });
        if (this.getFileGeneration(stats) !== expectedGeneration) {
          return;
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }

        throw error;
      }

      const model = await fileCacheRepo.findByHash(hash);
      if (model) {
        await fileCacheRepo.deleteByHash(hash);
      }

      try {
        await fs.unlink(resolvedPath);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    });
  }

  private getFileGeneration(stats: { dev: bigint; ino: bigint; mtimeNs: bigint; size: bigint }) {
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  }

  private async finalizeWrite(hash: string, tmpPath: string, finalPath: string) {
    try {
      const temporaryStats = await fs.stat(tmpPath);

      await FileCacheProvider.mutationQueue.add(async () => {
        if (temporaryStats.size !== 0) {
          try {
            await fs.link(tmpPath, finalPath);
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw error;
            }
          }

          const finalStats = await fs.stat(finalPath);
          const accessedAt = new Date();
          await fileCacheRepo.upsertFileCache(hash, finalStats.size, accessedAt);
        }

        await this.evictOldest();
      });
    } catch (error: unknown) {
      try {
        await this.removeTemporaryFile(tmpPath);
      } catch (cleanupError: unknown) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        debug(`Failed to clean up cache temporary file: ${message}`);
      }

      throw error;
    }

    await this.removeTemporaryFile(tmpPath);
  }

  private async removeTemporaryFile(tmpPath: string) {
    try {
      await fs.unlink(tmpPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private reportFinalizationError(stream: WriteStream, error: unknown) {
    const finalizationError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to finalize cache write:', finalizationError);
    debug(`Failed to finalize cache write: ${finalizationError.message}`);

    if (stream.listenerCount('error') > 0) {
      try {
        stream.emit('error', finalizationError);
      } catch (reportingError: unknown) {
        const message = reportingError instanceof Error ? reportingError.message : String(reportingError);
        debug(`Cache write error listener failed: ${message}`);
      }
    }
  }

  private reportWriteError(error: unknown) {
    const writeError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to write cache temporary file:', writeError);
    debug(`Failed to write cache temporary file: ${writeError.message}`);
  }

  private async evictOldest() {
    debug('Evicting oldest files...');

    let totalSizeBytes = await this.getDiskUsageInBytes();
    let numOfEvictedFiles = 0;

    while (totalSizeBytes > this.config.CACHE_LIMIT_IN_BYTES) {
      const oldest = await fileCacheRepo.findOldest();

      if (!oldest) {
        throw new Error(
          `Cache usage is ${totalSizeBytes} bytes, above the configured limit of ${this.config.CACHE_LIMIT_IN_BYTES} bytes, but no indexed file is available to evict`,
        );
      }

      await fileCacheRepo.deleteByHash(oldest.hash);
      await fs.unlink(path.join(this.config.CACHE_DIR, oldest.hash));
      debug(`${oldest.hash} has been evicted`);
      numOfEvictedFiles++;

      totalSizeBytes = await this.getDiskUsageInBytes();
    }

    if (numOfEvictedFiles > 0) {
      debug(`${numOfEvictedFiles} files have been evicted`);
    } else {
      debug(
        `No files needed to be evicted. Total size of the cache is currently ${totalSizeBytes} bytes, and the cache limit is ${this.config.CACHE_LIMIT_IN_BYTES} bytes.`,
      );
    }
  }

  private async removeOrphans() {
    const temporaryDirectory = path.join(this.config.CACHE_DIR, 'tmp');

    for await (const dirent of await fs.opendir(temporaryDirectory)) {
      if (dirent.isFile()) {
        debug(`${dirent.name} was abandoned in the cache temporary directory. Removing from disk.`);
        await fs.unlink(path.join(temporaryDirectory, dirent.name));
      }
    }

    for await (const dirent of await fs.opendir(this.config.CACHE_DIR)) {
      if (dirent.isFile()) {
        const model = await fileCacheRepo.findByHash(dirent.name);

        if (!model) {
          debug(`${dirent.name} was present on disk but was not in the database. Removing from disk.`);
          await fs.unlink(path.join(this.config.CACHE_DIR, dirent.name));
        }
      }
    }

    for await (const model of this.getFindAllIterable()) {
      const filePath = path.join(this.config.CACHE_DIR, model.hash);

      try {
        await fs.access(filePath);
      } catch {
        debug(`${model.hash} was present in database but was not on disk. Removing from database.`);
        await fileCacheRepo.deleteByHash(model.hash);
      }
    }
  }

  private async getDiskUsageInBytes() {
    return fileCacheRepo.sumBytes();
  }

  private getFindAllIterable() {
    const limit = 50;
    let previousHash: string | null = null;

    let models: FileCacheRow[] = [];

    const fetchNextBatch = async () => {
      models = await fileCacheRepo.findAllBatched(previousHash, limit);

      if (models.length > 0) {
        previousHash = models[models.length - 1].hash;
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (models.length === 0) {
              await fetchNextBatch();
            }

            if (models.length === 0) {
              return { done: true, value: null as unknown as FileCacheRow };
            }

            return { value: models.shift()!, done: false };
          },
        };
      },
    };
  }
}
