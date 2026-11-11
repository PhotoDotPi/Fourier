CREATE TABLE IF NOT EXISTS "PlayerPanel" (
  "guildId" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
