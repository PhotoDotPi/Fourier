const isTTY = Boolean(process.stderr.isTTY);

const wrap = (code: number) => (text: string) => (isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);

export const colors = {
  reset: wrap(0),
  bold: wrap(1),
  dim: wrap(2),
  italic: wrap(3),
  underline: wrap(4),

  black: wrap(30),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  white: wrap(37),

  brightBlack: wrap(90),
  brightRed: wrap(91),
  brightGreen: wrap(92),
  brightYellow: wrap(93),
  brightBlue: wrap(94),
  brightMagenta: wrap(95),
  brightCyan: wrap(96),
  brightWhite: wrap(97),
} as const;
