import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Emoji } from '../constants/emoji.js';
import { type default as Player, STATUS } from '../services/player.js';

export const PlayerButtonId = {
  Loop: 'player:loop',
  Pause: 'player:pause',
  Previous: 'player:previous',
  Queue: 'player:queue',
  Shuffle: 'player:shuffle',
  Skip: 'player:skip',
  Stop: 'player:stop',
  VolumeDown: 'player:volume_down',
  VolumeUp: 'player:volume_up',
} as const;

export const PanelButtonId = {
  Loop: 'panel:loop',
  Pause: 'panel:pause',
  Search: 'panel:search',
  Shuffle: 'panel:shuffle',
  Skip: 'panel:skip',
  Stop: 'panel:stop',
  VolumeDown: 'panel:volume_down',
  VolumeUp: 'panel:volume_up',
} as const;

export const PanelModalId = {
  Search: 'panel:search:modal',
  SearchQueryInput: 'panel:search:modal:query',
} as const;

export const QueueButtonId = {
  First: 'queue:first',
  Last: 'queue:last',
  Next: 'queue:next',
  NowPlaying: 'queue:now_playing',
  PageIndicator: 'queue:page:indicator',
  PageSelect: 'queue:page:select',
  Previous: 'queue:previous',
  Shuffle: 'queue:shuffle',
} as const;

export const SeekButtonId = {
  Back: 'seek:back10',
  Forward: 'seek:fwd10',
  Replay: 'seek:replay',
} as const;

export const ClearButtonId = {
  Cancel: 'clear:cancel',
  Confirm: 'clear:confirm',
} as const;

const canGoBack = (player: Player) => (typeof player.canGoBack === 'function' ? player.canGoBack() : false);
const canGoForward = (player: Player) => (typeof player.canGoForward === 'function' ? player.canGoForward(1) : false);
const isQueueEmpty = (player: Player) => (typeof player.isQueueEmpty === 'function' ? player.isQueueEmpty() : false);
const getVolume = (player: Player) => (typeof player.getVolume === 'function' ? player.getVolume() : 0);

export const buildPlayerControls = (player: Player): Array<ActionRowBuilder<MessageActionRowComponentBuilder>> => {
  const playing = player.status === STATUS.PLAYING;

  const previousButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Previous)
    .setEmoji(Emoji.Replay)
    .setLabel('Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!canGoBack(player));

  const toggleButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Pause)
    .setEmoji(playing ? Emoji.Pause : Emoji.Play)
    .setLabel(playing ? 'Pause' : 'Play')
    .setStyle(playing ? ButtonStyle.Primary : ButtonStyle.Success);

  const skipButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Skip)
    .setEmoji(Emoji.Next)
    .setLabel('Skip')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!canGoForward(player));

  const stopButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Stop)
    .setEmoji(Emoji.Stop)
    .setLabel('Stop')
    .setStyle(ButtonStyle.Danger);

  const rowOne = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    previousButton,
    toggleButton,
    stopButton,
    skipButton,
  );

  const queueButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Queue)
    .setEmoji(Emoji.Queue)
    .setLabel('Queue')
    .setStyle(ButtonStyle.Secondary);

  const shuffleButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Shuffle)
    .setEmoji(Emoji.Shuffle)
    .setLabel('Shuffle')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isQueueEmpty(player));

  const loopButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.Loop)
    .setEmoji(player.loopCurrentSong ? Emoji.RepeatOne : Emoji.RepeatAll)
    .setLabel('Loop')
    .setStyle(player.loopCurrentSong || player.loopCurrentQueue ? ButtonStyle.Success : ButtonStyle.Secondary);

  const volumeDownButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.VolumeDown)
    .setEmoji(Emoji.VolumeDown)
    .setLabel('Vol −')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(getVolume(player) <= 0);

  const volumeUpButton = new ButtonBuilder()
    .setCustomId(PlayerButtonId.VolumeUp)
    .setEmoji(Emoji.VolumeUp)
    .setLabel('Vol +')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(getVolume(player) >= 100);

  const rowTwo = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    queueButton,
    shuffleButton,
    loopButton,
    volumeDownButton,
    volumeUpButton,
  );

  return [rowOne, rowTwo];
};

export const buildQueueComponents = (options: {
  page: number;
  maxPage: number;
  canShuffle: boolean;
}): Array<ActionRowBuilder<MessageActionRowComponentBuilder>> => {
  const { canShuffle, maxPage, page } = options;
  const onFirstPage = page <= 1;
  const onLastPage = page >= maxPage;
  const pageSuffix = `:${page}`;

  const navigationRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${QueueButtonId.First}${pageSuffix}`)
      .setEmoji(Emoji.First)
      .setLabel('First')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(onFirstPage),
    new ButtonBuilder()
      .setCustomId(`${QueueButtonId.Previous}${pageSuffix}`)
      .setEmoji(Emoji.Replay)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(onFirstPage),
    new ButtonBuilder()
      .setCustomId(`${QueueButtonId.PageIndicator}${pageSuffix}`)
      .setLabel(`Page ${page}/${maxPage}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${QueueButtonId.Next}${pageSuffix}`)
      .setEmoji(Emoji.Next)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(onLastPage),
    new ButtonBuilder()
      .setCustomId(`${QueueButtonId.Last}${pageSuffix}`)
      .setEmoji(Emoji.Last)
      .setLabel('Last')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(onLastPage),
  );

  const rows: Array<ActionRowBuilder<MessageActionRowComponentBuilder>> = [navigationRow];

  if (maxPage > 1) {
    const pageSelect = new StringSelectMenuBuilder()
      .setCustomId(QueueButtonId.PageSelect)
      .setPlaceholder('Jump to page…')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        Array.from({ length: Math.min(maxPage, 25) }, (_, index) => {
          const pageNumber = index + 1;
          return new StringSelectMenuOptionBuilder().setLabel(`Page ${pageNumber}`).setValue(String(pageNumber));
        }),
      );

    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pageSelect));
  }

  const actionsRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QueueButtonId.NowPlaying)
      .setEmoji(Emoji.Play)
      .setLabel('Now Playing')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(QueueButtonId.Shuffle)
      .setEmoji(Emoji.Shuffle)
      .setLabel('Shuffle')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canShuffle),
  );

  rows.push(actionsRow);

  return rows;
};

export const buildSeekToolbar = (): Array<ActionRowBuilder<MessageActionRowComponentBuilder>> => [
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SeekButtonId.Back)
      .setEmoji(Emoji.SeekBack)
      .setLabel('Back 10s')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(SeekButtonId.Replay)
      .setEmoji(Emoji.Replay)
      .setLabel('Replay')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(SeekButtonId.Forward)
      .setEmoji(Emoji.SeekForward)
      .setLabel('Forward 10s')
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildClearConfirmRow = (): Array<ActionRowBuilder<MessageActionRowComponentBuilder>> => [
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ClearButtonId.Confirm)
      .setEmoji(Emoji.Trash)
      .setLabel('Clear Queue')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(ClearButtonId.Cancel)
      .setEmoji(Emoji.Success)
      .setLabel('Keep Playing')
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildPlayerPanelComponents = (
  player: Player,
): Array<ActionRowBuilder<MessageActionRowComponentBuilder>> => {
  const playing = player.status === STATUS.PLAYING;

  const toggleButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Pause)
    .setEmoji(playing ? Emoji.Pause : Emoji.Play)
    .setLabel(playing ? 'Pause' : 'Play')
    .setStyle(playing ? ButtonStyle.Primary : ButtonStyle.Success)
    .setDisabled(!player.getCurrent());

  const skipButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Skip)
    .setEmoji(Emoji.Next)
    .setLabel('Skip')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!canGoForward(player));

  const stopButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Stop)
    .setEmoji(Emoji.Stop)
    .setLabel('Stop')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!player.getCurrent());

  const rowOne = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    toggleButton,
    skipButton,
    stopButton,
  );

  const seekButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Search)
    .setEmoji(Emoji.Search)
    .setLabel('Search')
    .setStyle(ButtonStyle.Primary);

  const shuffleButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Shuffle)
    .setEmoji(Emoji.Shuffle)
    .setLabel('Shuffle')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isQueueEmpty(player));

  const loopButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.Loop)
    .setEmoji(player.loopCurrentSong ? Emoji.RepeatOne : Emoji.RepeatAll)
    .setLabel('Loop')
    .setStyle(player.loopCurrentSong || player.loopCurrentQueue ? ButtonStyle.Success : ButtonStyle.Secondary);

  const volumeDownButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.VolumeDown)
    .setEmoji(Emoji.VolumeDown)
    .setLabel('Vol −')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(getVolume(player) <= 0);

  const volumeUpButton = new ButtonBuilder()
    .setCustomId(PanelButtonId.VolumeUp)
    .setEmoji(Emoji.VolumeUp)
    .setLabel('Vol +')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(getVolume(player) >= 100);

  const rowTwo = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    seekButton,
    shuffleButton,
    loopButton,
    volumeDownButton,
    volumeUpButton,
  );

  return [rowOne, rowTwo];
};

export const buildPlayerPanelSearchModal = (): ModalBuilder => {
  return new ModalBuilder()
    .setCustomId(PanelModalId.Search)
    .setTitle(`${Emoji.Search} Queue a song`)
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(PanelModalId.SearchQueryInput)
          .setLabel('Search query or URL')
          .setPlaceholder('Any YouTube or Spotify link, or a search query…')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
};
