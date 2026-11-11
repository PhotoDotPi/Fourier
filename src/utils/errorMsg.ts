type FriendlyError = {
  title: string;
  description: string;
  footerDetail: string | null;
};

const KNOWN_ERRORS: Readonly<Record<string, FriendlyError>> = {
  'a favorite with that name already exists': {
    title: 'Duplicate favorite',
    description: 'A favorite with that name already exists. Try a different name.',
    footerDetail: null,
  },
  'already playing, give me a song name': {
    title: 'Already playing',
    description: 'Playback is already running. Use a different command to control it.',
    footerDetail: null,
  },
  "can't replay a livestream": {
    title: "Can't replay a livestream",
    description: 'Livestreams can only be played live, so replaying is not possible.',
    footerDetail: null,
  },
  "can't seek in a livestream": {
    title: "Can't seek in a livestream",
    description: 'Seeking is not available for livestreams.',
    footerDetail: null,
  },
  "can't seek past the end of the song": {
    title: "Can't seek that far",
    description: "You can't seek past the end of the song.",
    footerDetail: null,
  },
  'invalid limit': {
    title: 'Invalid limit',
    description: 'That playlist limit is invalid. Try a whole number between 1 and 50.',
    footerDetail: null,
  },
  'invalid number of songs to skip': {
    title: 'Invalid skip count',
    description: 'How many songs to skip must be a whole number of at least 1.',
    footerDetail: null,
  },
  'invalid seek value': {
    title: 'Invalid seek time',
    description: 'That seek time is invalid. Try something like `1m30s` or `0:45`.',
    footerDetail: null,
  },
  'missing seek value': {
    title: 'Missing seek time',
    description: 'Provide a time to seek to, like `1m30s` or `0:45`.',
    footerDetail: null,
  },
  'move index is outside the range of the queue': {
    title: "Can't move that song",
    description: 'That position is outside the range of the queue.',
    footerDetail: null,
  },
  'no favorite with that name exists': {
    title: 'Favorite not found',
    description: 'No favorite with that name exists in this server.',
    footerDetail: null,
  },
  'no playable songs found': {
    title: 'Nothing playable found',
    description: 'No playable songs were found for that input.',
    footerDetail: null,
  },
  'no playing song found': {
    title: 'Nothing playing',
    description: "There's nothing playing right now.",
    footerDetail: null,
  },
  'no song currently playing': {
    title: 'Nothing playing',
    description: "There's no song currently playing.",
    footerDetail: null,
  },
  'no song to go back to': {
    title: 'Nothing to go back to',
    description: "There's no previous song to go back to.",
    footerDetail: null,
  },
  'no song to loop!': {
    title: 'Nothing to loop',
    description: "There's no song to loop right now.",
    footerDetail: null,
  },
  'no song to skip to': {
    title: 'Nothing to skip to',
    description: "There's no next song to skip to.",
    footerDetail: null,
  },
  'no songs found': {
    title: 'Nothing found',
    description: 'No songs were found for that input.',
    footerDetail: null,
  },
  'no songs in queue to forward to': {
    title: 'Nothing to skip to',
    description: "There's no next song in the queue to skip to.",
    footerDetail: null,
  },
  'no songs in queue to go back to': {
    title: 'Nothing to go back to',
    description: "There's no previous song in the queue to go back to.",
    footerDetail: null,
  },
  'no songs to loop!': {
    title: 'Nothing to loop',
    description: 'There are no songs in the queue to loop.',
    footerDetail: null,
  },
  'not connected': {
    title: 'Not connected',
    description: "I'm not connected to a voice channel in this server.",
    footerDetail: null,
  },
  'not connected to a voice channel': {
    title: 'Not connected',
    description: "I'm not connected to a voice channel in this server.",
    footerDetail: null,
  },
  'not currently playing': {
    title: 'Nothing playing',
    description: 'Nothing is currently playing.',
    footerDetail: null,
  },
  'not enough songs to loop a queue': {
    title: 'Too few songs',
    description: 'There need to be at least two songs in the queue to loop it.',
    footerDetail: null,
  },
  'not enough songs to shuffle': {
    title: 'Too few songs',
    description: 'There need to be at least two songs in the queue to shuffle.',
    footerDetail: null,
  },
  'nothing is currently playing': {
    title: 'Nothing playing',
    description: "There's nothing playing right now.",
    footerDetail: null,
  },
  'nothing is playing': {
    title: 'Nothing playing',
    description: "There's nothing playing right now.",
    footerDetail: null,
  },
  'nothing to play': {
    title: 'Nothing to play',
    description: "There's nothing in the queue to play.",
    footerDetail: null,
  },
  'page must be at least 1': {
    title: 'Invalid page',
    description: 'The requested page must be at least 1.',
    footerDetail: null,
  },
  'position is outside the range of the queue': {
    title: "Can't remove that song",
    description: 'That position is outside the range of the queue.',
    footerDetail: null,
  },
  'position must be at least 1': {
    title: 'Invalid position',
    description: 'That position must be at least 1.',
    footerDetail: null,
  },
  'queue empty': {
    title: 'Queue is empty',
    description: 'The queue is empty.',
    footerDetail: null,
  },
  'queue is empty': {
    title: 'Queue is empty',
    description: 'The queue is empty.',
    footerDetail: null,
  },
  'range must be at least 1': {
    title: 'Invalid range',
    description: 'The range must be at least 1.',
    footerDetail: null,
  },
  'seek position is outside the range of the song': {
    title: "Can't seek that far",
    description: 'That position is outside the range of the song.',
    footerDetail: null,
  },
  'spotify is not enabled': {
    title: 'Spotify not available',
    description: 'Spotify support is not enabled on this bot.',
    footerDetail: null,
  },
  "the queue isn't that big": {
    title: 'Not that many pages',
    description: "The queue isn't that big.",
    footerDetail: null,
  },
  "that doesn't exist": {
    title: 'Not found',
    description: "That doesn't exist.",
    footerDetail: null,
  },
  'unknown subcommand': {
    title: 'Unknown action',
    description: 'That action is not recognized.',
    footerDetail: null,
  },
  'you can only remove your own favorites': {
    title: 'Not yours to remove',
    description: 'You can only remove your own favorites.',
    footerDetail: null,
  },
} as const;

const normalizeMessage = (message: string) =>
  message
    .toLowerCase()
    .replace(/[.!]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();

export const toFriendlyError = (error: unknown): FriendlyError => {
  if (error instanceof Error) {
    const known = KNOWN_ERRORS[normalizeMessage(error.message)];

    if (known) {
      return known;
    }
  }

  return {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again in a moment.',
    footerDetail: error instanceof Error ? error.message : String(error),
  };
};
