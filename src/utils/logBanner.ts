import { Emoji } from '../constants/emoji.js';
import { colors } from './colors.js';

const BANNER = [
  '  ______ ____  _    _ _____  _____ ______ _____  ',
  ' |  ____/ __ \\| |  | |  __ \\|_   _|  ____|  __ \\ ',
  ' | |__ | |  | | |  | | |__) | | | | |__  | |__) |',
  ' |  __|| |  | | |  | |  _  /  | | |  __| |  _  / ',
  ' | |   | |__| | |__| | | \\ \\ _| |_| |____| | \\ \\ ',
  ' |_|    \\____/ \\____/|_|  \\_\\_____|______|_|  \\_\\',
];

const GRADIENT: Array<(text: string) => string> = [
  colors.brightCyan,
  colors.brightBlue,
  colors.blue,
  colors.magenta,
  colors.brightMagenta,
];

const logBanner = async () => {
  let version = 'unknown';
  try {
    // Resolve relative to this module so the banner works from any working directory.
    const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    version = pkg.version ?? 'unknown';
  } catch {}

  const width = Math.max(...BANNER.map((line) => line.length));
  const bar = colors.dim('─'.repeat(width));

  for (let i = 0; i < BANNER.length; i++) {
    console.log(GRADIENT[i % GRADIENT.length](BANNER[i]));
  }

  console.log(bar);
  console.log(
    `${colors.brightWhite(colors.bold('Fourier'))} ${colors.dim('v')}${colors.brightCyan(version)} ${colors.dim('|')} ${colors.brightBlue('https://github.com/PhotoDotPi/fourier')}`,
  );
  console.log(
    `${colors.dim('Made with')} ${colors.brightRed(Emoji.Music)} ${colors.dim('by')} ${colors.brightMagenta('PhotoDotPi')}`,
  );

  if (process.env.BUILD_DATE) {
    console.log(`${colors.dim('Build:')} ${colors.brightWhite(process.env.BUILD_DATE)}`);
  }
  if (process.env.COMMIT_HASH) {
    console.log(`${colors.dim('Commit:')} ${colors.brightWhite(process.env.COMMIT_HASH)}`);
  }
  console.log('');
};

export default logBanner;
