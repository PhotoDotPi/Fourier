import { Emoji } from '../constants/emoji.js';

export default (width: number, progress: number): string => {
  const dotPosition = Math.max(0, Math.min(width - 1, Math.floor(width * progress)));

  let res = '';

  for (let i = 0; i < width; i++) {
    if (i === dotPosition) {
      res += Emoji.BarHead;
    } else {
      res += Emoji.BarTrack;
    }
  }

  return res;
};
