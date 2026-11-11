import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

export default interface Command {
  readonly slashCommand: {
    readonly toJSON: () => unknown;
    readonly name?: string;
  };
  readonly handledButtonIds?: readonly string[];
  readonly handledButtonIdPrefixes?: readonly string[];
  readonly handledModalIds?: readonly string[];
  readonly handledModalIdPrefixes?: readonly string[];
  readonly requiresVC?: boolean | ((interaction: ChatInputCommandInteraction) => boolean);
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  handleButtonInteraction?: (interaction: ButtonInteraction) => Promise<void>;
  handleSelectMenuInteraction?: (interaction: StringSelectMenuInteraction) => Promise<void>;
  handleAutocompleteInteraction?: (interaction: AutocompleteInteraction) => Promise<void>;
  handleModalSubmit?: (interaction: ModalSubmitInteraction) => Promise<void>;
}
