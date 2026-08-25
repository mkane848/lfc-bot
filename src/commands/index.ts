import type { GuildCommand } from '../types/index.js';
import { sellCommand } from './user/sell.js';
import { buyCommand } from './user/buy.js';
import { tradeCommand } from './user/trade.js';
import { searchCommand } from './user/search.js';
import { myListingsCommand } from './user/mylistings.js';
import { editCommand } from './user/edit.js';
import { fulfillCommand } from './user/fulfill.js';
import { deleteCommand } from './user/delete.js';
import { helpCommand } from './user/help.js';
import { adminCommand } from './admin/admin.js';

export const commands: GuildCommand[] = [
  sellCommand,
  buyCommand,
  tradeCommand,
  searchCommand,
  myListingsCommand,
  editCommand,
  fulfillCommand,
  deleteCommand,
  helpCommand,
  adminCommand,
];

export const commandMap = new Map<string, GuildCommand>(
  commands.map((command) => [command.name, command]),
);
