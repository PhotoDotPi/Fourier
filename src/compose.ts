import { Client, GatewayIntentBits } from 'discord.js';
import Bot from './bot.js';
import Clear from './commands/clear.js';
import ConfigCommand from './commands/config.js';
import Disconnect from './commands/disconnect.js';
import Favorites from './commands/favorites.js';
import ForwardSeek from './commands/fseek.js';
import type Command from './commands/index.js';
import Loop from './commands/loop.js';
import LoopQueue from './commands/loopQueue.js';
import Move from './commands/move.js';
import Next from './commands/next.js';
import NowPlaying from './commands/nowPlaying.js';
import Pause from './commands/pause.js';
import Play from './commands/play.js';
import QueueCommand from './commands/queue.js';
import Remove from './commands/remove.js';
import Replay from './commands/replay.js';
import Resume from './commands/resume.js';
import Seek from './commands/seek.js';
import Setup from './commands/setup.js';
import Shuffle from './commands/shuffle.js';
import Skip from './commands/skip.js';
import Stop from './commands/stop.js';
import Unskip from './commands/unskip.js';
import Volume from './commands/volume.js';
import PlayerManager from './managers/player.js';
import AddQueryToQueue from './services/addQueryToQueue.js';
import ConfigProvider from './services/config.js';
import FileCacheProvider from './services/fileCache.js';
import GetSongs from './services/getSongs.js';
import ItunesSearchService from './services/itunesSearch.js';
import KeyValueCacheProvider from './services/keyValueCache.js';
import MusicCardService from './services/musicCard.js';
import NowPlayingPresenter from './services/nowPlayingPresenter.js';
import PlayerIntegrations from './services/playerIntegrations.js';
import PlayerPanelManager from './services/playerPanel.js';
import SpotifyAPI from './services/spotifyApi.js';
import ThirdParty from './services/thirdParty.js';
import YoutubeAPI from './services/youtubeApi.js';

export interface AppDependencies {
  config: ConfigProvider;
  client: Client;
  bot: Bot;
  playerManager: PlayerManager;
  commands: Command[];
  fileCache: FileCacheProvider;
  playerPanelManager: PlayerPanelManager;
  playerIntegrations: PlayerIntegrations;
}

export function createApp(): AppDependencies {
  const config = new ConfigProvider();

  const intents: GatewayIntentBits[] = [];
  intents.push(GatewayIntentBits.Guilds);
  intents.push(GatewayIntentBits.GuildMessageReactions);
  intents.push(GatewayIntentBits.GuildVoiceStates);

  const client = new Client({ intents });

  const fileCache = new FileCacheProvider(config);
  const keyValueCache = new KeyValueCacheProvider();

  const youtubeAPI = new YoutubeAPI(config, keyValueCache);

  let spotifyAPI: SpotifyAPI | undefined;
  let thirdParty: ThirdParty | undefined;
  if (config.SPOTIFY_CLIENT_ID !== '' && config.SPOTIFY_CLIENT_SECRET !== '') {
    thirdParty = new ThirdParty(config);
    spotifyAPI = new SpotifyAPI(thirdParty);
  }

  const getSongs = new GetSongs(youtubeAPI, spotifyAPI);
  const playerManager = new PlayerManager(fileCache, youtubeAPI);
  const itunesSearch = new ItunesSearchService();
  const musicCard = new MusicCardService();
  const presenter = new NowPlayingPresenter(musicCard, itunesSearch);
  const addQueryToQueue = new AddQueryToQueue(getSongs, playerManager, config, keyValueCache, presenter);
  const playerIntegrations = new PlayerIntegrations(playerManager, client, config, keyValueCache);
  const playerPanelManager = new PlayerPanelManager(playerManager, client, addQueryToQueue, presenter);

  const commands: Command[] = [
    new Clear(playerManager),
    new ConfigCommand(),
    new Disconnect(playerManager),
    new Favorites(addQueryToQueue),
    new ForwardSeek(playerManager),
    new LoopQueue(playerManager),
    new Loop(playerManager),
    new Move(playerManager),
    new Next(playerManager, presenter),
    new NowPlaying(playerManager, presenter),
    new Pause(playerManager, presenter),
    new Play(thirdParty, keyValueCache, addQueryToQueue, (guildId) => playerIntegrations.getRecentTracks(guildId)),
    new QueueCommand(playerManager),
    new Remove(playerManager),
    new Replay(playerManager),
    new Resume(playerManager, presenter),
    new Seek(playerManager),
    new Setup(playerPanelManager),
    new Shuffle(playerManager),
    new Skip(playerManager, presenter),
    new Stop(playerManager),
    new Unskip(playerManager, presenter),
    new Volume(playerManager, presenter),
  ];

  const bot = new Bot(client, config);

  return { config, client, bot, playerManager, commands, fileCache, playerPanelManager, playerIntegrations };
}
