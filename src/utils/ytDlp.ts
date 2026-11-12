import { promises as fs, constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstNonEmpty } from './string.js';

interface YtDlpMediaDownload {
  readonly url?: string;
  readonly protocol?: string;
  readonly ext?: string;
  readonly acodec?: string;
  readonly vcodec?: string;
  readonly http_headers?: Record<string, string | null | undefined>;
}

interface YtDlpResponse extends YtDlpMediaDownload {
  readonly is_live?: boolean;
  readonly live_status?: string;
  readonly requested_downloads?: readonly YtDlpMediaDownload[];
}

export interface YtDlpMediaSource {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly isLive: boolean;
}

export interface YtDlpUpdateResult {
  readonly beforeVersion: string | null;
  readonly afterVersion: string | null;
  readonly updated: boolean;
  readonly skipped: boolean;
  readonly updateSucceeded: boolean;
  readonly error?: string;
}

export type YtDlpMediaUnavailableReason = 'age-restricted' | 'unavailable';

export class YtDlpMediaUnavailableError extends Error {
  readonly reason: YtDlpMediaUnavailableReason;

  constructor(message: string, reason: YtDlpMediaUnavailableReason = 'unavailable') {
    super(message);
    this.name = 'YtDlpMediaUnavailableError';
    this.reason = reason;
  }
}

const getMediaUnavailableReason = (detail: string): YtDlpMediaUnavailableReason | null => {
  if (/sign in to confirm your age/i.test(detail)) {
    return 'age-restricted';
  }

  return [
    /this video is not available/i,
    /video unavailable/i,
    /private video/i,
    /video has been removed/i,
    /members-only content/i,
  ].some((pattern) => pattern.test(detail))
    ? 'unavailable'
    : null;
};

const withTemporaryCookies = async <T>(operation: (cookiesPath?: string) => Promise<T>): Promise<T> => {
  const configuredCookiesPath = firstNonEmpty(process.env.YT_DLP_COOKIES_PATH);
  if (!configuredCookiesPath) {
    return operation();
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(tmpdir(), 'fourier-yt-dlp-'));
  const temporaryCookiesPath = path.join(temporaryDirectory, 'youtube-cookies.txt');

  try {
    await fs.chmod(temporaryDirectory, 0o700);
    await fs.copyFile(configuredCookiesPath, temporaryCookiesPath, fsConstants.COPYFILE_EXCL);
    await fs.chmod(temporaryCookiesPath, 0o600);

    return await operation(temporaryCookiesPath);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const bundledExecutable = () => path.join(process.cwd(), 'bin', 'yt-dlp');

export const getExecutable = () => {
  const configuredPath = firstNonEmpty(process.env.YT_DLP_PATH, process.env.FOURIER_BUNDLED_YT_DLP_PATH);

  return configuredPath ?? bundledExecutable();
};

interface BunProcessError {
  stderr?: string;
  exitCode?: number | null;
  stdout?: string;
}

const isBunProcessError = (error: unknown): error is BunProcessError =>
  typeof error === 'object' && error !== null && 'stderr' in error;

const getErrorMessage = (error: unknown) => {
  if (isBunProcessError(error)) {
    const stderr = error.stderr?.trim();

    return stderr ? stderr : `Unknown yt-dlp error (exit code ${error.exitCode ?? 'unknown'})`;
  }

  return error instanceof Error ? error.message : 'Unknown yt-dlp error';
};

const normalizeHeaders = (headers?: Record<string, string | null | undefined>) => {
  const normalizedEntries = Object.entries(headers ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  );

  return Object.fromEntries(normalizedEntries);
};

const toYouTubeWatchUrl = (videoIdOrUrl: string) =>
  videoIdOrUrl.length === 11 ? `https://www.youtube.com/watch?v=${videoIdOrUrl}` : videoIdOrUrl;

const EXTRACTION_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 10_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;

const spawnBun = async (
  command: string,
  args: string[],
  options: { timeout?: number; env?: Record<string, string> } = {},
) => {
  const proc = Bun.spawn([command, ...args], {
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });

  const timer = options.timeout ? setTimeout(() => proc.kill(), options.timeout) : undefined;

  try {
    const [stdout, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const error = new Error(stderrText.trim()) as Error & { stderr?: string; exitCode?: number | null };
      error.stderr = stderrText;
      error.exitCode = exitCode;
      throw error;
    }

    return stdout;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const spawnYtDlp = async (args: string[], options: { timeout?: number; env?: Record<string, string> } = {}) => {
  const hasConfiguredExecutable = Boolean(
    firstNonEmpty(process.env.YT_DLP_PATH, process.env.FOURIER_BUNDLED_YT_DLP_PATH),
  );
  const executable = (await ensureExecutable()) ?? (hasConfiguredExecutable ? getExecutable() : 'yt-dlp');
  return spawnBun(executable, args, options);
};

export const getYtDlpVersion = async (): Promise<string> => {
  const stdout = await spawnYtDlp(['--version'], { timeout: VERSION_TIMEOUT_MS });
  return stdout.trim();
};

const pathExists = async (candidatePath: string, mode = fsConstants.F_OK) => {
  try {
    await fs.access(candidatePath, mode);
    return true;
  } catch {
    return false;
  }
};

const hasPathSeparator = (candidatePath: string) => candidatePath.includes('/') || candidatePath.includes('\\');

const getCommandCandidates = (command: string) => {
  if (process.platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const executableExtensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((extension) => `${command}${extension.toLowerCase()}`);

  return [command, ...executableExtensions];
};

const findExecutableOnPath = async (command: string) => {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const candidate of getCommandCandidates(command)) {
      const candidatePath = path.join(directory, candidate);
      if (await pathExists(candidatePath, fsConstants.X_OK)) {
        return candidatePath;
      }
    }
  }

  return null;
};

const resolveExecutablePath = async () => {
  const executable = getExecutable();

  if (path.isAbsolute(executable)) {
    return executable;
  }

  if (hasPathSeparator(executable)) {
    return path.resolve(executable);
  }

  return findExecutableOnPath(executable);
};

export const ensureExecutable = async (): Promise<string | null> => {
  const executable = await resolveExecutablePath();
  if (!executable) {
    return null;
  }

  if (process.platform === 'win32') {
    return executable;
  }

  const exists = await pathExists(executable, fsConstants.F_OK);
  if (!exists) {
    return null;
  }

  const executableOk = await pathExists(executable, fsConstants.X_OK);
  if (executableOk) {
    return executable;
  }

  try {
    const currentMode = (await fs.stat(executable)).mode;
    await fs.chmod(executable, currentMode | 0o100);
  } catch {
    return null;
  }

  return (await pathExists(executable, fsConstants.X_OK)) ? executable : null;
};

const getPythonExecutableForYtDlp = async () => {
  const executable = await resolveExecutablePath();
  if (!executable) {
    return null;
  }

  const realExecutable = await fs.realpath(executable);
  const binDirectory = path.dirname(realExecutable);
  const pythonExecutable = path.join(binDirectory, process.platform === 'win32' ? 'python.exe' : 'python');

  return (await pathExists(pythonExecutable)) ? pythonExecutable : null;
};

const updateWithPip = async () => {
  const pythonExecutable = await getPythonExecutableForYtDlp();
  if (!pythonExecutable) {
    return false;
  }

  await spawnBun(
    pythonExecutable,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', 'yt-dlp[default]'],
    {
      timeout: UPDATE_TIMEOUT_MS,
      env: {
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        PIP_NO_INPUT: '1',
      },
    },
  );
  return true;
};

const updateWithYtDlpSelfUpdate = async () => {
  await spawnYtDlp(['-U'], { timeout: UPDATE_TIMEOUT_MS });
  return true;
};

const joinErrors = (errors: string[]) => (errors.length > 0 ? errors.join('; ') : undefined);

export const updateYtDlp = async (): Promise<YtDlpUpdateResult> => {
  let beforeVersion: string | null = null;
  try {
    beforeVersion = await getYtDlpVersion();
  } catch {}

  const errors: string[] = [];
  let attemptedUpdate = false;
  let updateSucceeded = false;

  try {
    const didAttemptUpdate = await updateWithPip();
    if (didAttemptUpdate) {
      attemptedUpdate = true;
      updateSucceeded = true;
    }
  } catch (error: unknown) {
    attemptedUpdate = true;
    errors.push(getErrorMessage(error));
  }

  if (!updateSucceeded) {
    try {
      await updateWithYtDlpSelfUpdate();
      attemptedUpdate = true;
      updateSucceeded = true;
    } catch (error: unknown) {
      attemptedUpdate = true;
      errors.push(getErrorMessage(error));
    }
  }

  let afterVersion: string | null = null;
  try {
    afterVersion = await getYtDlpVersion();
  } catch (error: unknown) {
    const updateErrors = updateSucceeded ? [] : errors;

    return {
      beforeVersion,
      afterVersion,
      updated: false,
      skipped: !attemptedUpdate,
      updateSucceeded,
      error: joinErrors([...updateErrors, getErrorMessage(error)]),
    };
  }

  const error = updateSucceeded ? undefined : joinErrors(errors);

  return {
    beforeVersion,
    afterVersion,
    updated: beforeVersion !== null && beforeVersion !== afterVersion,
    skipped: !attemptedUpdate,
    updateSucceeded,
    error,
  };
};

export const getYouTubeMediaSource = async (videoIdOrUrl: string): Promise<YtDlpMediaSource> => {
  try {
    return await withTemporaryCookies(async (cookiesPath) => {
      const args = [
        '--dump-single-json',
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        '--no-cache-dir',
        '--js-runtimes',
        'node',
        '-f',
        'bestaudio/best',
        '-S',
        'proto:https',
      ];

      if (cookiesPath) {
        args.push('--cookies', cookiesPath);
      }

      args.push(toYouTubeWatchUrl(videoIdOrUrl));

      const stdout = await spawnYtDlp(args, { timeout: EXTRACTION_TIMEOUT_MS });

      const response = JSON.parse(stdout) as YtDlpResponse;
      const download = response.requested_downloads?.at(0) ?? response;

      if (!download.url) {
        throw new Error('yt-dlp did not return a playable media URL.');
      }

      return {
        url: download.url,
        headers: normalizeHeaders(download.http_headers ?? response.http_headers),
        isLive: Boolean(response.is_live ?? response.live_status === 'is_live'),
      };
    });
  } catch (error: unknown) {
    if (isBunProcessError(error)) {
      const detail = error.stderr?.trim() ?? 'Unknown yt-dlp error';
      const extractionError = `yt-dlp failed to extract media: ${detail}`;

      const unavailableReason = getMediaUnavailableReason(detail);
      if (unavailableReason) {
        throw new YtDlpMediaUnavailableError(extractionError, unavailableReason);
      }

      throw new Error(extractionError);
    }

    if (error instanceof SyntaxError) {
      throw new Error('yt-dlp returned an invalid response.');
    }

    throw error;
  }
};
