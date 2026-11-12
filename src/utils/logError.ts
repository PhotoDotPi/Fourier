import { colors } from './colors.js';

const describe = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
};

const logError = (prefix: string, error: unknown): void => {
  const line = colors.dim('─'.repeat(60));
  console.error('');
  console.error(colors.brightRed(colors.bold(`✗ ${prefix}`)));
  console.error(line);
  console.error(colors.red(describe(error) || 'unknown error'));
  console.error(line);
  console.error('');
};

export default logError;
