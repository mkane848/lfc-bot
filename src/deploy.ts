import type { Client } from 'discord.js';
import { commands } from './commands/index.js';
import { getLogger } from './utils/logger.js';

/**
 * Register slash commands. When `DISCORD_GUILD_ID` is set (development), the
 * commands are registered only to that guild; otherwise they are registered
 * globally.
 */
export async function deployCommands(client: Client): Promise<void> {
  const logger = getLogger();
  const guildId = process.env.DISCORD_GUILD_ID;
  const payload = commands.map((command) => command.data.toJSON());

  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.commands.set(payload);
    logger.info(`Registered ${payload.length} commands to guild ${guildId}`);
    return;
  }

  const app = client.application;
  if (!app) {
    logger.warn('No application available; skipping command registration');
    return;
  }
  await app.commands.set(payload);
  logger.info(`Registered ${payload.length} commands globally`);
}
