import type {
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandBuilder,
} from '@discordjs/builders';

type OptionParent = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder;

export const addQueueOptions = <T extends OptionParent>(builder: T): T => {
  builder
    .addBooleanOption((option) => option.setName('immediate').setDescription('add track to the front of the queue'))
    .addBooleanOption((option) =>
      option.setName('shuffle').setDescription("shuffle the input if you're adding multiple tracks"),
    )
    .addBooleanOption((option) => option.setName('split').setDescription('if a track has chapters, split it'))
    .addBooleanOption((option) => option.setName('skip').setDescription('skip the currently playing track'));

  return builder;
};
