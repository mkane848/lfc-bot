import type { Interaction } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { handleListingButton } from '../commands/user/mylistings.js';
import { handleEditModal } from '../commands/user/edit.js';
import { getLogger } from '../utils/logger.js';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      await handleListingButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleEditModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      return;
    }
    await command.execute(interaction);
  } catch (err) {
    getLogger().error({ err }, 'Unhandled interaction error');
    await replySafe(interaction, 'Something went wrong. Please try again.');
  }
}

async function replySafe(interaction: Interaction, message: string): Promise<void> {
  try {
    if (!interaction.isRepliable()) {
      return;
    }
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch {
    // Best effort only.
  }
}
