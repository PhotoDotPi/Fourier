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
  // Outbound request targets a media URL returned by yt-dlp or an explicitly configured HLS stream.
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

const isRetryableStatus = (status: number) => status === 403 || status === 429 || status >= 500;

const buildRangeHeaders = (headers: Record<string, string>, start: number, end: number): Record<string, string> => {
  const requestHeaders: Record<string, string> = { Range: `bytes=${start}-${end}` };

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'host' && value) {
      requestHeaders[key] = value;
    }
  }

  return requestHeaders;
};

type RangeAttempt =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly error: unknown };

const fetchRangeAttempt = async (
  url: string,
  headers: Record<string, string>,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<RangeAttempt> => {
  try {
    const response = await fetchFollowingRedirects(
      url,
      buildRangeHeaders(headers, start, end),
      NETWORK_MEDIA_MAX_REDIRECTS,
      signal,
    );
    return { ok: true, response };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return { ok: false, error };
  }
};

const RETRY_RANGE = Symbol('retry-range');

const interpretRangeResponse = async (
  response: Response,
  start: number,
  end: number,
  truncatable: boolean,
  isLastAttempt: boolean,
): Promise<FetchedRange | null | typeof RETRY_RANGE> => {
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

  if (!isRetryableStatus(response.status) || isLastAttempt) {
    throw new Error(`Media server returned HTTP ${response.status} for byte range ${start}-${end}`);
  }

  return RETRY_RANGE;
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
    const isLastAttempt = attempt === NETWORK_MEDIA_MAX_ATTEMPTS;
    const result = await fetchRangeAttempt(url, headers, start, end, signal);

    if (!result.ok) {
      lastError = result.error;
      if (!isLastAttempt) {
        await sleep(NETWORK_MEDIA_RETRY_DELAY_MS * attempt);
      }
      continue;
    }

    const outcome = await interpretRangeResponse(result.response, start, end, truncatable, isLastAttempt);

    if (outcome !== RETRY_RANGE) {
      return outcome;
    }

    if (!isLastAttempt) {
      await sleep(NETWORK_MEDIA_RETRY_DELAY_MS * attempt);
    }
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

interface SpawnedFfmpeg {
  readonly proc: ChildProcess;
  readonly stdout: Readable;
  readonly stderr: Readable;
}

type CacheWriteStream = ReturnType<FileCacheProvider['createWriteStream']>;

interface CacheStreams {
  readonly readStream?: Readable;
  readonly writeStream?: CacheWriteStream;
}

interface StreamContext {
  readonly options: CreateReadStreamOptions;
  readonly networkStream: boolean;
  readonly proc: ChildProcess;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly capacitor: WriteStream;
  readonly startupProbeStream: Readable;
  readonly opusProbe: prismMedia.opus.WebmDemuxer;
  readonly returnedStream: Readable;
  readonly abortController?: AbortController;
  readonly cacheReadStream?: Readable;
  readonly cacheWriteStream?: CacheWriteStream;
  readonly stderrChunks: Buffer[];
  mediaReader?: Readable;
  cacheWriteAborted: boolean;
  cacheReadEnded: boolean;
  ffmpegEnded: boolean;
  hasReturnedStreamClosed: boolean;
  startupSettled: boolean;
  startupTimeout?: ReturnType<typeof setTimeout>;
  readonly resolve: (stream: Readable) => void;
  readonly reject: (error: unknown) => void;
}

interface StartupHandlers {
  readonly rejectStartup: (error: unknown) => void;
  readonly onPlayablePacket: () => void;
  readonly onEndBeforePlayablePacket: () => void;
}

const buildFfmpegArgs = (options: CreateReadStreamOptions, networkStream: boolean): string[] => {
  const inputOptions = options.inputOptions ?? (networkStream ? [] : ['-re']);

  return networkStream
    ? [...inputOptions, '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-f', 'webm', '-']
    : [...inputOptions, '-i', options.url, '-vn', '-c:a', 'libopus', '-f', 'webm', '-'];
};

const spawnFfmpeg = (args: string[], networkStream: boolean): SpawnedFfmpeg => {
  try {
    const proc = spawn(FFMPEG_EXECUTABLE, args, {
      stdio: networkStream ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    if (!proc.stdout || !proc.stderr) {
      throw new FfmpegStartupError(new Error('FFmpeg process has no stdout/stderr'));
    }

    return { proc, stdout: proc.stdout, stderr: proc.stderr };
  } catch (error) {
    throw error instanceof FfmpegStartupError ? error : new FfmpegStartupError(error);
  }
};

const createCacheStreams = (options: CreateReadStreamOptions, capacitor: WriteStream): CacheStreams => {
  if (!options.cache || !options.fileCache || !options.hashFn) {
    return {};
  }

  const writeStream = options.fileCache.createWriteStream(options.hashFn(options.cacheKey ?? options.url));
  const readStream = capacitor.createReadStream();
  readStream.pipe(writeStream, { end: false });

  return { readStream, writeStream };
};

const createStreamContext = (
  options: CreateReadStreamOptions,
  resolve: (stream: Readable) => void,
  reject: (error: unknown) => void,
): StreamContext => {
  const networkStream = options.networkStream === true && isHttpUrl(options.url);
  const { proc, stdout, stderr } = spawnFfmpeg(buildFfmpegArgs(options, networkStream), networkStream);

  const capacitor = new WriteStream();
  const { readStream, writeStream } = createCacheStreams(options, capacitor);

  return {
    options,
    networkStream,
    proc,
    stdout,
    stderr,
    capacitor,
    startupProbeStream: capacitor.createReadStream(),
    opusProbe: new prismMedia.opus.WebmDemuxer(),
    returnedStream: capacitor.createReadStream(),
    abortController: networkStream ? new AbortController() : undefined,
    cacheReadStream: readStream,
    cacheWriteStream: writeStream,
    stderrChunks: [],
    cacheWriteAborted: false,
    cacheReadEnded: false,
    ffmpegEnded: false,
    hasReturnedStreamClosed: false,
    startupSettled: false,
    resolve,
    reject,
  };
};

const normalizeStartupError = (error: unknown): Error =>
  error instanceof FfmpegMediaUnavailableError || error instanceof FfmpegStartupError
    ? error
    : new FfmpegStartupError(error);

const destroyMediaInput = (ctx: StreamContext): void => {
  ctx.abortController?.abort();
  ctx.mediaReader?.destroy();

  if (ctx.proc.stdin) {
    ctx.proc.stdin.destroy();
  }
};

const destroyCacheWrite = (ctx: StreamContext): void => {
  if (ctx.cacheWriteAborted) {
    return;
  }

  ctx.cacheWriteAborted = true;
  ctx.cacheReadStream?.destroy();
  ctx.cacheWriteStream?.destroy();
};

const finalizeCacheWrite = (ctx: StreamContext): void => {
  if (
    !ctx.cacheWriteAborted &&
    ctx.cacheReadEnded &&
    ctx.ffmpegEnded &&
    ctx.cacheWriteStream &&
    !ctx.cacheWriteStream.writableEnded
  ) {
    ctx.cacheWriteStream.end();
  }
};

const createStartupHandlers = (ctx: StreamContext): StartupHandlers => {
  function cleanupStartupListeners(): void {
    if (ctx.startupTimeout) {
      clearTimeout(ctx.startupTimeout);
      ctx.startupTimeout = undefined;
    }

    ctx.opusProbe.off('data', onPlayablePacket);
    ctx.startupProbeStream.off('end', onEndBeforePlayablePacket);
  }

  function rejectStartup(error: unknown): void {
    if (ctx.startupSettled) {
      return;
    }

    ctx.startupSettled = true;
    cleanupStartupListeners();
    destroyMediaInput(ctx);
    destroyCacheWrite(ctx);
    ctx.startupProbeStream.destroy();
    ctx.opusProbe.destroy();
    ctx.returnedStream.destroy();
    ctx.capacitor.destroy();
    killProcess(ctx.proc);
    ctx.reject(normalizeStartupError(error));
  }

  function onPlayablePacket(): void {
    if (ctx.startupSettled) {
      return;
    }

    ctx.startupSettled = true;
    cleanupStartupListeners();
    ctx.startupProbeStream.destroy();
    ctx.opusProbe.destroy();
    ctx.resolve(ctx.returnedStream);
  }

  function onEndBeforePlayablePacket(): void {
    if (ctx.ffmpegEnded) {
      rejectStartup(
        new FfmpegMediaUnavailableError(new Error('FFmpeg produced no playable Opus audio.'), 'invalid-output'),
      );
    }
  }

  return { rejectStartup, onPlayablePacket, onEndBeforePlayablePacket };
};

const onFfmpegEnd = (ctx: StreamContext, handlers: StartupHandlers): void => {
  ctx.ffmpegEnded = true;
  finalizeCacheWrite(ctx);

  if (ctx.startupProbeStream.readableEnded) {
    handlers.onEndBeforePlayablePacket();
  }
};

const onBufferError = (ctx: StreamContext, handlers: StartupHandlers, error: unknown): void => {
  if (!ctx.startupSettled) {
    handlers.rejectStartup(new FfmpegStartupError(error));
    return;
  }

  console.error(`Playback buffer failed: ${sanitizeFfmpegError(error)}`);
  destroyCacheWrite(ctx);
};

const onCacheWriteError = (ctx: StreamContext, error: unknown): void => {
  console.warn(`Disabling cache write: ${sanitizeFfmpegError(error)}`);
  destroyCacheWrite(ctx);
};

const onMediaReaderError = (ctx: StreamContext, handlers: StartupHandlers, error: unknown): void => {
  if (isAbortError(error) || (error as NodeJS.ErrnoException | null)?.code === 'EPIPE') {
    return;
  }

  destroyCacheWrite(ctx);

  if (!ctx.startupSettled) {
    handlers.rejectStartup(new FfmpegStartupError(error, { executable: FFMPEG_EXECUTABLE }));
    return;
  }

  console.error(`Media fetch failed during playback: ${sanitizeFfmpegError(error)}`);
  killProcess(ctx.proc);

  if (!ctx.capacitor.writableEnded) {
    ctx.capacitor.end();
  }
};

const onFfmpegStdoutError = (ctx: StreamContext, handlers: StartupHandlers, error: unknown): void => {
  destroyCacheWrite(ctx);

  if (ctx.hasReturnedStreamClosed) {
    return;
  }

  if (!ctx.startupSettled) {
    handlers.rejectStartup(new FfmpegStartupError(error));
    return;
  }

  console.error(`FFmpeg stream failed after playback began: ${sanitizeFfmpegError(error)}`);

  if (!ctx.capacitor.writableEnded) {
    ctx.capacitor.end();
  }
};

const onReturnedStreamClose = (ctx: StreamContext): void => {
  if (!ctx.options.cache) {
    destroyMediaInput(ctx);
    killProcess(ctx.proc);
  }

  ctx.hasReturnedStreamClosed = true;

  if (!ctx.capacitor.destroyed) {
    ctx.capacitor.release();
  }
};

const onProcError = (ctx: StreamContext, handlers: StartupHandlers, error: unknown): void => {
  if (!ctx.startupSettled) {
    handlers.rejectStartup(new FfmpegStartupError(error));
  }
};

const onProcClose = (
  ctx: StreamContext,
  handlers: StartupHandlers,
  code: number | null,
  signal: NodeJS.Signals | null,
): void => {
  if (ctx.startupSettled) {
    return;
  }

  const stderrText = Buffer.concat(ctx.stderrChunks).toString('utf-8').trim();

  handlers.rejectStartup(
    new FfmpegStartupError(new Error(stderrText || `FFmpeg exited with code ${code ?? signal ?? 'unknown'}`), {
      executable: FFMPEG_EXECUTABLE,
      version: getFfmpegVersionFromStderr(stderrText),
      exitCode: code,
      inputContext: ctx.networkStream ? describeMediaInput(ctx.options.url) : undefined,
      operation: 'audio transcoding',
    }),
  );
};

const startNetworkMedia = (ctx: StreamContext, handlers: StartupHandlers): void => {
  const { abortController, proc } = ctx;

  if (!ctx.networkStream || !abortController || !proc.stdin) {
    return;
  }

  ctx.mediaReader = Readable.from(readNetworkMedia(ctx.options.url, ctx.options.headers ?? {}, abortController.signal));
  ctx.mediaReader.once('close', () => abortController.abort());
  ctx.mediaReader.on('error', (error) => onMediaReaderError(ctx, handlers, error));
  proc.stdin.on('error', () => ctx.mediaReader?.destroy());
  ctx.mediaReader.pipe(proc.stdin);
};

const wireStreams = (ctx: StreamContext, handlers: StartupHandlers): void => {
  const {
    stdout,
    stderr,
    capacitor,
    startupProbeStream,
    returnedStream,
    opusProbe,
    cacheReadStream,
    cacheWriteStream,
  } = ctx;

  stderr.on('data', (chunk: Buffer) => {
    ctx.stderrChunks.push(chunk);
  });

  stdout.pipe(capacitor);
  stdout.on('end', () => onFfmpegEnd(ctx, handlers));
  stdout.on('error', (error) => onFfmpegStdoutError(ctx, handlers, error));

  capacitor.on('error', (error) => onBufferError(ctx, handlers, error));
  startupProbeStream.on('error', (error) => onBufferError(ctx, handlers, error));
  returnedStream.on('error', (error) => onBufferError(ctx, handlers, error));
  opusProbe.on('error', (error) => onBufferError(ctx, handlers, error));
  cacheReadStream?.on('error', (error) => onCacheWriteError(ctx, error));
  cacheReadStream?.once('end', () => {
    ctx.cacheReadEnded = true;
    finalizeCacheWrite(ctx);
  });
  cacheWriteStream?.on('error', (error) => onCacheWriteError(ctx, error));

  opusProbe.once('data', handlers.onPlayablePacket);
  startupProbeStream.once('end', handlers.onEndBeforePlayablePacket);
  startupProbeStream.pipe(opusProbe);

  returnedStream.on('close', () => onReturnedStreamClose(ctx));

  ctx.proc.on('error', (error) => onProcError(ctx, handlers, error));
  ctx.proc.on('close', (code, signal) => onProcClose(ctx, handlers, code, signal));
};

const armStartupTimeout = (ctx: StreamContext, handlers: StartupHandlers): void => {
  ctx.startupTimeout = setTimeout(() => {
    handlers.rejectStartup(
      new FfmpegStartupError(
        new Error(`FFmpeg produced no playable audio within ${FFMPEG_STARTUP_TIMEOUT_MS / 1000} seconds.`),
      ),
    );
  }, FFMPEG_STARTUP_TIMEOUT_MS);
};

const startSession = (
  options: CreateReadStreamOptions,
  resolve: (stream: Readable) => void,
  reject: (error: unknown) => void,
): void => {
  const ctx = createStreamContext(options, resolve, reject);
  const handlers = createStartupHandlers(ctx);

  startNetworkMedia(ctx, handlers);
  wireStreams(ctx, handlers);
  armStartupTimeout(ctx, handlers);
};

export function createReadStream(options: CreateReadStreamOptions): Promise<Readable> {
  return new Promise((resolve, reject) => {
    try {
      startSession(options, resolve, reject);
    } catch (error) {
      reject(normalizeStartupError(error));
    }
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
