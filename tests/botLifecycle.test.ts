import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { ActivityType, ChannelType, Collection, MessageFlags } from 'discord.js';

const mocks = {
  spinner: {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    text: '',
  },
  debug: vi.fn(),
  dependencyReport: vi.fn(() => 'dependency report'),
  login: vi.fn(),
  playerConstructions: [] as Array<{
    fileCache: unknown;
    findAudioFallback: (song: unknown) => Promise<unknown>;
    guildId: string;
  }>,
  restPut: vi.fn(),
  restSetToken: vi.fn(),
  settingUpsert: vi.fn(),
  voiceStateHandler: vi.fn(),
};

mock.module('../src/utils/spinner.js', () => ({
  default: vi.fn(() => mocks.spinner),
}));

mock.module('@discordjs/rest', () => ({
  REST: class {
    setToken(token: string) {
      mocks.restSetToken(token);
      return this;
    }

    put(route: string, options: unknown) {
      return mocks.restPut(route, options);
    }
  },
}));

mock.module('@discordjs/voice', () => ({
  generateDependencyReport: mocks.dependencyReport,
}));

mock.module('../src/db/repositories/settings.js', () => ({
  upsertSetting: mocks.settingUpsert,
}));

mock.module('../src/utils/debug.js', () => ({
  default: mocks.debug,
}));

mock.module('../src/services/player.js', () => ({
  default: class {
    readonly fileCache: unknown;
    readonly findAudioFallback: (song: unknown) => Promise<unknown>;
    readonly guildId: string;

    constructor(fileCache: unknown, guildId: string, findAudioFallback: (song: unknown) => Promise<unknown>) {
      this.fileCache = fileCache;
      this.guildId = guildId;
      this.findAudioFallback = findAudioFallback;
      mocks.playerConstructions.push(this);
    }
  },
}));

import Bot from '../src/bot.js';
import handleGuildCreate from '../src/events/guildCreate.js';
import PlayerManager from '../src/managers/player.js';

const COMMAND_NAMES = [
  'clear',
  'config',
  'disconnect',
  'favorites',
  'fseek',
  'loop-queue',
  'loop',
  'move',
  'next',
  'now-playing',
  'pause',
  'play',
  'queue',
  'remove',
  'replay',
  'resume',
  'seek',
  'shuffle',
  'skip',
  'stop',
  'unskip',
  'volume',
] as const;

type Handler = (...args: never[]) => unknown;

interface StructuralCommand {
  execute?: ReturnType<typeof vi.fn>;
  requiresVC?: boolean | ((interaction: StructuralInteraction) => boolean);
  slashCommand: {
    name: string;
    toJSON: ReturnType<typeof vi.fn>;
  };
}

interface StructuralInteraction {
  channelId: string | null;
  commandName: string;
  deferred: boolean;
  editReply: ReturnType<typeof vi.fn>;
  guild: object | null;
  guildId: string | null;
  isAutocomplete: () => boolean;
  isButton: () => boolean;
  isChatInputCommand: () => boolean;
  isCommand: () => boolean;
  member?: { user: { id: string } };
  options: { getSubcommand: () => string };
  replied: boolean;
  reply: ReturnType<typeof vi.fn>;
  type: number;
  user: { id: string };
}

const makeCommand = (name: string, overrides: Partial<StructuralCommand> = {}): StructuralCommand => ({
  execute: vi.fn().mockResolvedValue(undefined),
  slashCommand: {
    name,
    toJSON: vi.fn(() => ({ description: `${name} command`, name })),
  },
  ...overrides,
});

const makeCommandSet = () => COMMAND_NAMES.map((name) => makeCommand(name));

const makeConfig = (registerCommandsOnBot: boolean, activityUrl = '') => ({
  BOT_ACTIVITY: 'preservation music',
  BOT_ACTIVITY_TYPE: ActivityType.Streaming,
  BOT_ACTIVITY_URL: activityUrl,
  BOT_STATUS: 'idle' as const,
  DISCORD_TOKEN: 'fake-token',
  REGISTER_COMMANDS_ON_BOT: registerCommandsOnBot,
});

const makeClient = (guildIds: string[] = []) => {
  const handlers = new Map<string, Handler>();
  const setPresence = vi.fn();
  const client = {
    guilds: {
      cache: new Collection(guildIds.map((id) => [id, { id }])),
    },
    login: mocks.login,
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return client;
    }),
    once: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return client;
    }),
    user: {
      id: 'application-id',
      setPresence,
    },
  };

  return { client, handlers, setPresence };
};

const makeInteraction = (
  commandName: string,
  overrides: Partial<StructuralInteraction> = {},
): StructuralInteraction => ({
  channelId: 'channel-id',
  commandName,
  deferred: false,
  editReply: vi.fn().mockResolvedValue(undefined),
  guild: { channels: { cache: new Collection() } },
  guildId: 'guild-id',
  isAutocomplete: () => false,
  isButton: () => false,
  isChatInputCommand: () => true,
  isCommand: () => true,
  member: { user: { id: 'member-id' } },
  options: { getSubcommand: () => 'list' },
  replied: false,
  reply: vi.fn().mockResolvedValue(undefined),
  type: 2,
  user: { id: 'member-id' },
  ...overrides,
});

const registerBot = async (registerCommandsOnBot: boolean, commands = makeCommandSet(), guildIds: string[] = []) => {
  const config = makeConfig(registerCommandsOnBot, 'https://example.test/stream');
  const clientState = makeClient(guildIds);

  const bot = new Bot(clientState.client as never, config as never);
  const onGuildCreate = handleGuildCreate(config as never, clientState.client as never, commands as never);
  await bot.register(commands as never, onGuildCreate, mocks.voiceStateHandler);

  return { ...clientState, commands, config };
};

const invoke = async (handlers: Map<string, Handler>, event: string, ...args: unknown[]) => {
  const handler = handlers.get(event);
  expect(handler).toBeTypeOf('function');
  await handler!(...(args as never[]));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockResolvedValue(undefined);
  mocks.restPut.mockResolvedValue(undefined);
  mocks.settingUpsert.mockResolvedValue({ guildId: 'guild-new' });
  mocks.spinner.text = '';
  mocks.spinner.start.mockReturnValue(mocks.spinner);
  mocks.playerConstructions.splice(0);
});

describe('Discord command registration and ready lifecycle', () => {
  it('replaces global commands with the full command set in bot registration mode', async () => {
    const { commands, handlers, setPresence } = await registerBot(true, makeCommandSet(), ['guild-a', 'guild-b']);

    expect(mocks.login).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledWith();
    await invoke(handlers, 'clientReady');

    expect(mocks.restSetToken).toHaveBeenCalledWith('fake-token');
    expect(mocks.restPut).toHaveBeenCalledOnce();
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/commands', {
      body: commands.map((command) => command.slashCommand.toJSON()),
    });
    const restPutOrder = mocks.restPut.mock.invocationCallOrder[0];
    const setPresenceOrder = setPresence.mock.invocationCallOrder[0];
    expect(setPresenceOrder).toBeGreaterThan(restPutOrder);
  });

  it('registers the non-deprecated clientReady listener and no legacy ready listener', async () => {
    const { handlers } = await registerBot(true);

    expect(handlers.has('clientReady')).toBe(true);
    expect(handlers.has('ready')).toBe(false);
  });

  it('registers every cached guild and removes global commands in guild registration mode', async () => {
    const { commands, handlers } = await registerBot(false, makeCommandSet(), ['guild-a', 'guild-b']);

    await invoke(handlers, 'clientReady');

    const body = commands.map((command) => command.slashCommand.toJSON());
    expect(mocks.restPut).toHaveBeenCalledTimes(3);
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-a/commands', { body });
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-b/commands', { body });
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/commands', { body: [] });
  });

  it('applies configured presence and reports dependency diagnostics plus the invite link', async () => {
    const { handlers, setPresence } = await registerBot(true);

    await invoke(handlers, 'clientReady');

    expect(mocks.dependencyReport).toHaveBeenCalledOnce();
    expect(mocks.debug).toHaveBeenCalledWith('dependency report');
    expect(setPresence).toHaveBeenCalledWith({
      activities: [
        {
          name: 'preservation music',
          type: ActivityType.Streaming,
          url: 'https://example.test/stream',
        },
      ],
      status: 'idle',
    });
    const setPresenceOrder = setPresence.mock.invocationCallOrder[0];
    const succeedOrder = mocks.spinner.succeed.mock.invocationCallOrder[0];
    expect(succeedOrder).toBeGreaterThan(setPresenceOrder);
    expect(mocks.spinner.succeed).toHaveBeenCalledWith(
      'Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=application-id&scope=bot%20applications.commands&permissions=36700160',
    );
  });

  it('omits an empty activity URL from presence', async () => {
    const commands = makeCommandSet();
    const config = makeConfig(true);
    const { client, handlers, setPresence } = makeClient();

    await new Bot(client as never, config as never).register(
      commands as never,
      handleGuildCreate(config as never, client as never, commands as never),
      mocks.voiceStateHandler,
    );
    await invoke(handlers, 'clientReady');

    expect(setPresence).toHaveBeenCalledWith(
      expect.objectContaining({
        activities: [expect.objectContaining({ url: undefined })],
      }),
    );
  });

  it('routes client errors to console and Discord debug events to the debug logger', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handlers } = await registerBot(true);
    const clientError = new Error('client failure');

    await invoke(handlers, 'error', clientError);
    await invoke(handlers, 'debug', 'gateway trace');

    expect(consoleError).toHaveBeenCalledWith(clientError);
    expect(mocks.debug).toHaveBeenCalledWith('gateway trace');
    consoleError.mockRestore();
  });
});

describe('guild onboarding', () => {
  it('creates guild settings, registers guild commands, and DMs the owner in guild mode', async () => {
    const commands = makeCommandSet();
    const { handlers } = await registerBot(false, commands);
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    const guild = {
      fetchOwner: vi.fn().mockResolvedValue({ send: ownerSend }),
      id: 'guild-new',
    };

    await invoke(handlers, 'guildCreate', guild);

    expect(mocks.settingUpsert).toHaveBeenCalledWith('guild-new');
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-new/commands', {
      body: commands.map((command) => command.slashCommand.toJSON()),
    });
    expect(guild.fetchOwner).toHaveBeenCalledOnce();
    expect(ownerSend).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/PhotoDotPi/Fourier/wiki/Configuring-Bot-Permissions'),
    );
  });

  it('skips guild command registration in global mode but still initializes and welcomes', async () => {
    const { handlers } = await registerBot(true);
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    const guild = {
      fetchOwner: vi.fn().mockResolvedValue({ send: ownerSend }),
      id: 'guild-global',
    };

    await invoke(handlers, 'guildCreate', guild);

    expect(mocks.settingUpsert).toHaveBeenCalledWith('guild-global');
    expect(mocks.restPut).not.toHaveBeenCalled();
    expect(ownerSend).toHaveBeenCalledOnce();
  });
});

describe('interaction boundaries', () => {
  it('rejects chat-input commands used outside a guild', async () => {
    const command = makeCommand('play');
    const { handlers } = await registerBot(true, [command]);
    const interaction = makeInteraction('play', { guild: null });

    await invoke(handlers, 'interactionCreate', interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Heads up', description: "You can't use this bot in a DM." }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('ephemerally rejects a voice-required command when the caller is outside voice', async () => {
    const command = makeCommand('play', { requiresVC: true });
    const { handlers } = await registerBot(true, [command]);
    const interaction = makeInteraction('play');

    await invoke(handlers, 'interactionCreate', interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Heads up',
            description: 'You need to be in a voice channel for this command.',
          }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('allows a voice-required command when the caller is in any guild voice channel', async () => {
    const command = makeCommand('play', { requiresVC: true });
    const { handlers } = await registerBot(true, [command]);
    const members = new Collection([['member-id', { id: 'member-id' }]]);
    const guild = {
      channels: {
        cache: new Collection([['voice-id', { members, type: ChannelType.GuildVoice }]]),
      },
    };
    const interaction = makeInteraction('play', { guild });

    await invoke(handlers, 'interactionCreate', interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('evaluates conditional voice guards and leaves non-voice actions available', async () => {
    const command = makeCommand('favorites', {
      requiresVC: (interaction) => interaction.options.getSubcommand() === 'use',
    });
    const { handlers } = await registerBot(true, [command]);
    const list = makeInteraction('favorites');
    const use = makeInteraction('favorites', { options: { getSubcommand: () => 'use' } });

    await invoke(handlers, 'interactionCreate', list);
    await invoke(handlers, 'interactionCreate', use);

    expect(command.execute).toHaveBeenCalledOnce();
    expect(command.execute).toHaveBeenCalledWith(list);
    expect(use.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Heads up',
            description: 'You need to be in a voice channel for this command.',
          }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  });

  it('debug-logs command failures and sends a fresh ephemeral error response', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('command failure');
    const command = makeCommand('play', { execute: vi.fn().mockRejectedValue(failure) });
    const { handlers } = await registerBot(true, [command]);
    const interaction = makeInteraction('play');

    await invoke(handlers, 'interactionCreate', interaction);

    expect(mocks.debug).toHaveBeenCalledWith('Error: command failure');
    expect(errorLog).toHaveBeenCalledWith(
      'Discord interaction failed (/play, guild=guild-id, channel=channel-id, user=member-id): Error: command failure',
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Something went wrong',
            description: 'An unexpected error occurred. Please try again in a moment.',
            footer: { text: 'command failure' },
          }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('redacts case-insensitive URLs from interaction logs and user error responses', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error(
      'request HTTPS://user:password@example.test/audio?token=secret failed Authorization: Basic basicsecret\r\nCookie: sid=sessionsecret; refresh=refreshsecret\r\n"token":"jsonsecret"',
    );
    const command = makeCommand('play', { execute: vi.fn().mockRejectedValue(failure) });
    const { handlers } = await registerBot(true, [command]);
    const interaction = makeInteraction('play');

    await invoke(handlers, 'interactionCreate', interaction);

    const sanitized = 'request [URL] failed Authorization: [redacted] Cookie: [redacted] "token":[redacted]';
    expect(mocks.debug).toHaveBeenCalledWith(`Error: ${sanitized}`);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`Error: ${sanitized}`));
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('password');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('token=secret');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('basicsecret');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('jsonsecret');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('sessionsecret');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('refreshsecret');
    expect(interaction.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Something went wrong',
            description: 'An unexpected error occurred. Please try again in a moment.',
            footer: { text: sanitized },
          }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  });

  it('edits deferred failures and swallows a failed error response', async () => {
    const command = makeCommand('play', { execute: vi.fn().mockRejectedValue(new Error('command failure')) });
    const { handlers } = await registerBot(true, [command]);
    const interaction = makeInteraction('play', {
      deferred: true,
      editReply: vi.fn().mockRejectedValue(new Error('message deleted')),
    });

    await expect(invoke(handlers, 'interactionCreate', interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Something went wrong',
            description: 'An unexpected error occurred. Please try again in a moment.',
            footer: { text: 'command failure' },
          }),
        }),
      ],
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('per-guild Player isolation', () => {
  it('reuses one Player within a guild and creates a separate Player for another guild', async () => {
    const fileCache = { kind: 'fake cache' };
    const youtubeAPI = { findAudioFallback: vi.fn().mockResolvedValue({ title: 'fallback' }) };
    const manager = new PlayerManager(fileCache as never, youtubeAPI as never);

    const guildA = manager.get('guild-a');
    const guildAAgain = manager.get('guild-a');
    const guildB = manager.get('guild-b');

    expect(guildAAgain).toBe(guildA);
    expect(guildB).not.toBe(guildA);
    expect(mocks.playerConstructions.map((player) => player.guildId)).toEqual(['guild-a', 'guild-b']);
    expect(mocks.playerConstructions.every((player) => player.fileCache === fileCache)).toBe(true);

    const song = { title: 'restricted' };
    await mocks.playerConstructions[0].findAudioFallback(song);
    expect(youtubeAPI.findAudioFallback).toHaveBeenCalledWith(song);
  });
});
