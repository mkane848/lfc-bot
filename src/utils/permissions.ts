import {
  GuildMember,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type PermissionResolvable,
} from 'discord.js';

export const MANAGE_SERVER: PermissionResolvable = PermissionFlagsBits.ManageGuild;

/**
 * Returns true when the member has the given permission. Guild-only commands
 * should call this before acting on admin subcommands.
 */
export function hasPermission(
  member: GuildMember | null,
  permission: PermissionResolvable = MANAGE_SERVER,
): boolean {
  if (!member) {
    return false;
  }
  return member.permissions.has(permission);
}

/**
 * Guard helper used inside admin commands. Replies ephemerally and returns
 * false when the user lacks the required permission.
 */
export async function requireManageServer(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const member = interaction.member;
  if (member instanceof GuildMember && hasPermission(member)) {
    return true;
  }
  const permissions = interaction.memberPermissions;
  if (permissions?.has(MANAGE_SERVER)) {
    return true;
  }
  await interaction.reply({
    content: 'You need the Manage Server permission to use admin commands.',
    ephemeral: true,
  });
  return false;
}
