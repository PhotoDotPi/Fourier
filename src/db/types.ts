export interface FileCacheRow {
  hash: string;
  bytes: number;
  accessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KeyValueCacheRow {
  key: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingRow {
  guildId: string;
  playlistLimit: number;
  secondsToWaitAfterQueueEmpties: number;
  leaveIfNoListeners: boolean;
  queueAddResponseEphemeral: boolean;
  autoAnnounceNextSong: boolean;
  defaultVolume: number;
  defaultQueuePageSize: number;
  turnDownVolumeWhenPeopleSpeak: boolean;
  turnDownVolumeWhenPeopleSpeakTarget: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FavoriteQueryRow {
  id: number;
  guildId: string;
  authorId: string;
  name: string;
  query: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerPanelRow {
  guildId: string;
  channelId: string;
  messageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
