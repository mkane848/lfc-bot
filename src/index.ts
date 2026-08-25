import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { runMigrations } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { deployCommands } from './deploy.js';
import { handleReady } from './events/ready.js';
import { handleInteractionCreate } from './events/interactionCreate.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { handleGuildDelete } from './events/guildDelete.js';
import { stopAllJobs } from './services/scheduler.js';
import { getLogger } from './utils/logger.js';

async function main(): Promise<void> {
  const logger = getLogger();

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    logger.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required. See .env.example.');
    process.exit(1);
  }

  runMigrations();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    void deployCommands(readyClient)
      .then(() => handleReady(readyClient))
      .catch((err: unknown) => logger.error({ err }, 'Failed to prepare on ready'));
  });
  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteractionCreate(interaction);
  });
  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.GuildDelete, handleGuildDelete);

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'Discord client error');
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}; shutting down`);
    stopAllJobs();
    void client.destroy();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(token);
  logger.info('Bot is online');
}

void main().catch((err: unknown) => {
  getLogger().error({ err }, 'Fatal startup error');
  process.exit(1);
});
