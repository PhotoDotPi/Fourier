import parse from 'parse-duration';

const numberPattern = '[+-]?(?:\\d+(?:[,_]\\d+)*(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';
const durationUnitPattern =
  '(?:nanoseconds?|ns|µs|μs|us|microseconds?|milliseconds?|ms|seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|wks?|wk|w|months?|b|years?|yrs?|yr|y)';
const secondsPattern = new RegExp(`^${numberPattern}$`, 'i');
const durationPattern = new RegExp(`^(?:${numberPattern}\\s*${durationUnitPattern}\\s*)+$`, 'iu');

const durationStringToSeconds = (str: string): number => {
  const normalized = str.trim();

  if (secondsPattern.test(normalized)) {
    const seconds = Number(normalized.replace(/[,_]/g, ''));
    return Number.isFinite(seconds) ? seconds : Number.NaN;
  }

  if (!durationPattern.test(normalized)) {
    return Number.NaN;
  }

  const milliseconds = parse(normalized);
  return milliseconds !== null && Number.isFinite(milliseconds) ? milliseconds / 1000 : Number.NaN;
};

export default durationStringToSeconds;
