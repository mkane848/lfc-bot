import type { GuildCommand } from '../types/index.js';
import { haveCommand } from './user/have.js';
import { haveMultiCommand } from './user/have-multi.js';
import { wantCommand } from './user/want.js';
import { wantMultiCommand } from './user/want-multi.js';
import { searchCommand } from './user/search.js';
import { myListingsCommand } from './user/mylistings.js';
import { editCommand } from './user/edit.js';
import { fulfillCommand } from './user/fulfill.js';
import { deleteCommand } from './user/delete.js';
import { helpCommand } from './user/help.js';
import { adminCommand } from './admin/admin.js';

export const commands: GuildCommand[] = [
  haveCommand,
  haveMultiCommand,
  wantCommand,
  wantMultiCommand,
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
