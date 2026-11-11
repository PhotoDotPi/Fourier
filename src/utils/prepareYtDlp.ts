import type Config from '../services/config.js';
import { colors } from './colors.js';
import { ensureExecutable, getExecutable, getYtDlpVersion, updateYtDlp } from './ytDlp.js';

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

const logUnavailableVersion = (error: unknown) => {
  console.warn(
    `${colors.brightYellow('⚠')} YT_DLP_VERSION=${colors.brightYellow('unavailable')} (${getExecutable()}: ${getErrorMessage(error)})`,
  );
};

export default async function prepareYtDlp(config: Config): Promise<void> {
  const executable = await ensureExecutable();
  if (!executable) {
    console.warn(
      `${colors.brightYellow('⚠')} Configured yt-dlp at ${getExecutable()} is missing or cannot be made executable; ` +
        'playback will fail. Ensure the file exists and is writable by the bot user, or set YT_DLP_PATH to a valid install.',
    );
  }

  if (!config.YT_DLP_AUTO_UPDATE) {
    try {
      console.log(`${colors.brightCyan('ℹ')} YT_DLP_VERSION=${await getYtDlpVersion()} (${getExecutable()})`);
    } catch (error: unknown) {
      logUnavailableVersion(error);
    }

    return;
  }

  console.log(`${colors.brightCyan('ℹ')} YT_DLP_AUTO_UPDATE=true (${getExecutable()})`);

  const updateResult = await updateYtDlp();
  if (updateResult.error) {
    console.warn(`${colors.brightYellow('⚠')} yt-dlp update warning: ${updateResult.error}`);
  }

  if (!updateResult.afterVersion) {
    console.warn(`${colors.brightYellow('⚠')} YT_DLP_VERSION=unavailable after auto-update`);
    return;
  }

  if (updateResult.updated && updateResult.beforeVersion) {
    console.log(
      `${colors.brightCyan('ℹ')} YT_DLP_VERSION=${updateResult.afterVersion} (updated from ${updateResult.beforeVersion})`,
    );
    return;
  }

  if (!updateResult.updateSucceeded) {
    console.log(
      `${colors.brightYellow('⚠')} YT_DLP_VERSION=${updateResult.afterVersion} (update failed; continuing with installed version)`,
    );
    return;
  }

  console.log(`${colors.brightCyan('ℹ')} YT_DLP_VERSION=${updateResult.afterVersion} (already current)`);
}
