import { SlashCommandBuilder } from '@discordjs/builders';
import Skip from './skip.js';

export default class Next extends Skip {
  public readonly slashCommand = new SlashCommandBuilder().setName('next').setDescription('skip to the next song');
}
