import { type ChildProcess, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import prismMedia from 'prism-media';
import { WriteStream } from '../utils/fileCapacitor.js';
import type FileCacheProvider from './fileCache.js';

const FFMPEG_EXECUTABLE = 'ffmpeg';
const FFMPEG_STARTUP_TIMEOUT_MS = 20_000;
const NETWORK_MEDIA_CHUNK_SIZE = 256 * 1024;
const NETWORK_MEDIA_MAX_ATTEMPTS = 4;
const NETWORK_MEDIA_MAX_REDIRECTS = 5;
const NETWORK_MEDIA_RETRY_DELAY_MS = 500;
const MAX_SANITIZED_ERROR_CHARS = 800;

const sanitizeFfmpegError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);

  return detail
    .replace(/https?:\/\/\S+/gi, '[media URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SANITIZED_ERROR_CHARS);
};

const describeMediaInput = (url: string) => (/^https?:\/\//i.test(url) ? '[media URL]' : url);

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getFfmpegVersionFromStderr = (stderrText: string): string | undefined => {
  const match = /^ffmpeg version (\S+)/m.exec(stderrText);
  return match?.[1];
};

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

export class FfmpegMediaUnavailableError extends Error {
  public readonly reason: 'invalid-output' | 'not-found' | 'unavailable';

  constructor(error: unknown, reason: 'invalid-output' | 'not-found' | 'unavailable' = 'unavailable') {
    const detail = sanitizeFfmpegError(error);
    super(`FFmpeg could not start audio transcoding${detail ? `: ${detail}` : ''}`);
    this.name = 'FfmpegMediaUnavailableError';
    this.reason = reason;
  }
}

export interface FfmpegStartupDiagnostic {
  readonly executable?: string;
  readonly version?: string;
  readonly exitCode?: number | null;
  readonly inputContext?: string;
  readonly operation?: string;
}

export class FfmpegStartupError extends Error {
  public readonly executable?: string;
  public readonly ffmpegVersion?: string;
  public readonly exitCode?: number | null;
  public readonly inputContext?: string;
  public readonly operation?: string;

  constructor(error: unknown, diagnostic: FfmpegStartupDiagnostic = {}) {
    const detail = sanitizeFfmpegError(error);
    const context = [
      diagnostic.executable,
      diagnostic.version ? `version ${diagnostic.version}` : '',
      diagnostic.exitCode !== undefined && diagnostic.exitCode !== null ? `exit code ${diagnostic.exitCode}` : '',
      diagnostic.inputContext,
    ]
      .filter(Boolean)
      .join(', ');
    super(
      `FFmpeg could not initialize audio transcoding${context ? ` (${context})` : ''}${detail ? `: ${detail}` : ''}`,
    );
    this.name = 'FfmpegStartupError';
    this.executable = diagnostic.executable;
    this.ffmpegVersion = diagnostic.version;
    this.exitCode = diagnostic.exitCode;
    this.inputContext = diagnostic.inputContext;
    this.operation = diagnostic.operation;
  }
}

export class FfmpegProcessError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FfmpegProcessError';
  }
}

const getStartupError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  const isInvalidOutput = /Invalid data found when processing input/i.test(detail);
  const isNotFound = /(?:HTTP error|Server returned) (?:404|410)|404 Not Found|410 Gone/i.test(detail);

  if (isInvalidOutput) {
    return new FfmpegMediaUnavailableError(error, 'invalid-output');
  }

  if (isNotFound) {
    return new FfmpegMediaUnavailableError(error, 'not-found');
  }

  return new FfmpegStartupError(error);
};

export const getStartupErrorForTesting = getStartupError;

const killProcess = (proc: ChildProcess | null) => {
  if (proc && !proc.killed) {
    proc.kill('SIGKILL');
  }
};

interface FetchedRange {
  readonly body: ReadableStream<Uint8Array>;
  readonly complete: boolean;
}

const fetchFollowingRedirects = async (
  url: string,
  headers: Record<string, string>,
  redirectsLeft: number,
  signal: AbortSignal,
): Promise<Response> => {
  const response = await fetch(url, { headers, redirect: 'manual', signal });

  if (redirectsLeft > 0 && response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      await response.body?.cancel();
      return fetchFollowingRedirects(new URL(location, url).toString(), headers, redirectsLeft - 1, signal);
    }
  }

  return response;
};

const fetchMediaRange = async (
  url: string,
  headers: Record<string, string>,
  start: number,
  end: number,
  signal: AbortSignal,
  truncatable: boolean,
): Promise<FetchedRange | null> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NETWORK_MEDIA_MAX_ATTEMPTS; attempt += 1) {
    let response: Response | undefined;

    try {
      const requestHeaders: Record<string, string> = { Range: `bytes=${start}-${end}` };
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== 'host' && value) {
          requestHeaders[key] = value;
        }
      }
      response = await fetchFollowingRedirects(url, requestHeaders, NETWORK_MEDIA_MAX_REDIRECTS, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < NETWORK_MEDIA_MAX_ATTEMPTS) {
        await sleep(NETWORK_MEDIA_RETRY_DELAY_MS * attempt);
      }
      continue;
    }

    if (response.status === 416) {
      await response.body?.cancel();
      return null;
    }

    if (response.ok && response.body) {
      return { body: response.body, complete: response.status !== 206 };
    }

    await response.body?.cancel();

    if (truncatable) {
      return null;
    }

    const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === NETWORK_MEDIA_MAX_ATTEMPTS) {
      throw new Error(`Media server returned HTTP ${response.status} for byte range ${start}-${end}`);
    }

    await sleep(NETWORK_MEDIA_RETRY_DELAY_MS * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export const readNetworkMedia = async function* readNetworkMedia(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  let start = 0;
  let truncatable = false;

  for (;;) {
    const end = start + NETWORK_MEDIA_CHUNK_SIZE - 1;
    const range = await fetchMediaRange(url, headers, start, end, signal, truncatable);

    if (!range) {
      return;
    }

    const reader = range.body.getReader();
    let received = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += value.byteLength;
        yield Buffer.from(value);
      }
    } finally {
      await reader.cancel();
    }

    if (range.complete || received < NETWORK_MEDIA_CHUNK_SIZE) {
      return;
    }

    truncatable = true;
    start = end + 1;
  }
};

export interface CreateReadStreamOptions {
  readonly url: string;
  readonly inputOptions?: string[];
  readonly cacheKey?: string;
  readonly cache?: boolean;
  readonly fileCache?: FileCacheProvider;
  readonly hashFn?: (input: string) => string;
  readonly networkStream?: boolean;
  readonly headers?: Record<string, string>;
}

export function createReadStream(options: CreateReadStreamOptions): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const networkStream = options.networkStream === true && isHttpUrl(options.url);
    const inputOptions = options.inputOptions ?? (networkStream ? [] : ['-re']);
    const args = networkStream
      ? [...inputOptions, '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-f', 'webm', '-']
      : [...inputOptions, '-i', options.url, '-vn', '-c:a', 'libopus', '-f', 'webm', '-'];

    let proc: ChildProcess | null = null;

    try {
      proc = spawn(FFMPEG_EXECUTABLE, args, {
        stdio: networkStream ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new FfmpegStartupError(error));
      return;
    }

    const procStdout = proc.stdout;
    const procStderr = proc.stderr;

    if (!procStdout || !procStderr) {
      reject(new FfmpegStartupError(new Error('FFmpeg process has no stdout/stderr')));
      return;
    }

    const abortController = networkStream ? new AbortController() : undefined;
    let mediaReader: Readable | undefined;

    const stderrChunks: Buffer[] = [];

    procStderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const capacitor = new WriteStream();
    const startupProbeStream = capacitor.createReadStream();
    const opusProbe = new prismMedia.opus.WebmDemuxer();
    let cacheReadStream: Readable | undefined;
    let cacheWriteStream: ReturnType<FileCacheProvider['createWriteStream']> | undefined;

    if (options.cache && options.fileCache && options.hashFn) {
      cacheWriteStream = options.fileCache.createWriteStream(options.hashFn(options.cacheKey ?? options.url));
      cacheReadStream = capacitor.createReadStream();
      cacheReadStream.pipe(cacheWriteStream, { end: false });
    }

    const returnedStream = capacitor.createReadStream();
    let cacheWriteAborted = false;
    let cacheReadEnded = false;
    let ffmpegEnded = false;
    let hasReturnedStreamClosed = false;
    let startupSettled = false;
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;

    const cleanupStartupListeners = () => {
      if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = undefined;
      }

      opusProbe.off('data', onPlayablePacket);
      startupProbeStream.off('end', onEndBeforePlayablePacket);
    };

    const destroyMediaInput = () => {
      abortController?.abort();
      mediaReader?.destroy();
      if (proc?.stdin) {
        proc.stdin.destroy();
      }
    };

    const destroyCacheWrite = () => {
      if (cacheWriteAborted) {
        return;
      }

      cacheWriteAborted = true;
      cacheReadStream?.destroy();
      cacheWriteStream?.destroy();
    };

    const finalizeCacheWriteIfComplete = () => {
      if (!cacheWriteAborted && cacheReadEnded && ffmpegEnded && cacheWriteStream && !cacheWriteStream.writableEnded) {
        cacheWriteStream.end();
      }
    };

    const rejectStartup = (error: unknown) => {
      if (startupSettled) {
        return;
      }

      startupSettled = true;
      cleanupStartupListeners();
      destroyMediaInput();
      destroyCacheWrite();
      startupProbeStream.destroy();
      opusProbe.destroy();
      returnedStream.destroy();
      capacitor.destroy();
      killProcess(proc);
      reject(
        error instanceof FfmpegMediaUnavailableError || error instanceof FfmpegStartupError
          ? error
          : new FfmpegStartupError(error),
      );
    };

    const onPlayablePacket = () => {
      if (startupSettled) {
        return;
      }

      startupSettled = true;
      cleanupStartupListeners();
      startupProbeStream.destroy();
      opusProbe.destroy();
      resolve(returnedStream);
    };

    const onEndBeforePlayablePacket = () => {
      if (ffmpegEnded) {
        rejectStartup(
          new FfmpegMediaUnavailableError(new Error('FFmpeg produced no playable Opus audio.'), 'invalid-output'),
        );
      }
    };

    const onFfmpegEnd = () => {
      ffmpegEnded = true;
      finalizeCacheWriteIfComplete();
      if (startupProbeStream.readableEnded) {
        onEndBeforePlayablePacket();
      }
    };

    const onBufferError = (error: unknown) => {
      if (!startupSettled) {
        rejectStartup(new FfmpegStartupError(error));
        return;
      }

      console.error(`Playback buffer failed: ${sanitizeFfmpegError(error)}`);
      destroyCacheWrite();
    };

    const onCacheWriteError = (error: unknown) => {
      console.warn(`Disabling cache write: ${sanitizeFfmpegError(error)}`);
      destroyCacheWrite();
    };

    const onMediaReaderError = (error: unknown) => {
      if (isAbortError(error) || (error as NodeJS.ErrnoException | null)?.code === 'EPIPE') {
        return;
      }

      destroyCacheWrite();

      if (!startupSettled) {
        rejectStartup(new FfmpegStartupError(error, { executable: FFMPEG_EXECUTABLE }));
        return;
      }

      console.error(`Media fetch failed during playback: ${sanitizeFfmpegError(error)}`);
      killProcess(proc);
      if (!capacitor.writableEnded) {
        capacitor.end();
      }
    };

    if (networkStream && abortController && proc.stdin) {
      mediaReader = Readable.from(readNetworkMedia(options.url, options.headers ?? {}, abortController.signal));
      mediaReader.once('close', () => abortController.abort());
      mediaReader.on('error', onMediaReaderError);
      proc.stdin.on('error', () => mediaReader?.destroy());
      mediaReader.pipe(proc.stdin);
    }

    procStdout.pipe(capacitor);

    procStdout.on('end', onFfmpegEnd);

    procStdout.on('error', (error) => {
      destroyCacheWrite();

      if (hasReturnedStreamClosed) {
        return;
      }

      if (!startupSettled) {
        rejectStartup(new FfmpegStartupError(error));
        return;
      }

      console.error(`FFmpeg stream failed after playback began: ${sanitizeFfmpegError(error)}`);
      if (!capacitor.writableEnded) {
        capacitor.end();
      }
    });

    capacitor.on('error', onBufferError);
    startupProbeStream.on('error', onBufferError);
    returnedStream.on('error', onBufferError);
    opusProbe.on('error', onBufferError);
    cacheReadStream?.on('error', onCacheWriteError);
    cacheReadStream?.once('end', () => {
      cacheReadEnded = true;
      finalizeCacheWriteIfComplete();
    });
    cacheWriteStream?.on('error', onCacheWriteError);
    opusProbe.once('data', onPlayablePacket);
    startupProbeStream.once('end', onEndBeforePlayablePacket);
    startupProbeStream.pipe(opusProbe);

    startupTimeout = setTimeout(() => {
      rejectStartup(
        new FfmpegStartupError(
          new Error(`FFmpeg produced no playable audio within ${FFMPEG_STARTUP_TIMEOUT_MS / 1000} seconds.`),
        ),
      );
    }, FFMPEG_STARTUP_TIMEOUT_MS);

    returnedStream.on('close', () => {
      if (!options.cache) {
        destroyMediaInput();
        killProcess(proc);
      }

      hasReturnedStreamClosed = true;

      if (!capacitor.destroyed) {
        capacitor.release();
      }
    });

    proc.on('error', (error) => {
      if (!startupSettled) {
        rejectStartup(new FfmpegStartupError(error));
      }
    });

    proc.on('close', (code, signal) => {
      if (!startupSettled) {
        const stderrText = Buffer.concat(stderrChunks).toString('utf-8').trim();
        rejectStartup(
          new FfmpegStartupError(new Error(stderrText || `FFmpeg exited with code ${code ?? signal ?? 'unknown'}`), {
            executable: FFMPEG_EXECUTABLE,
            version: getFfmpegVersionFromStderr(stderrText),
            exitCode: code,
            inputContext: networkStream ? describeMediaInput(options.url) : undefined,
            operation: 'audio transcoding',
          }),
        );
      }
    });
  });
}

export interface FfmpegProbeResult {
  readonly format?: {
    readonly duration?: string;
    readonly format_name?: string;
  };
  readonly streams?: Array<{
    readonly codec_type?: string;
    readonly codec_name?: string;
    readonly sample_rate?: string;
    readonly channels?: number;
  }>;
}

export async function ffprobe(input: string): Promise<FfmpegProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input]);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        reject(new FfmpegProcessError(`ffprobe failed (exit code ${code}): ${stderr}`));
        return;
      }

      try {
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        resolve(JSON.parse(stdout) as FfmpegProbeResult);
      } catch (error) {
        reject(new FfmpegProcessError('Failed to parse ffprobe output', error));
      }
    });

    proc.on('error', (error) => {
      reject(new FfmpegProcessError('Failed to spawn ffprobe', error));
    });
  });
}
