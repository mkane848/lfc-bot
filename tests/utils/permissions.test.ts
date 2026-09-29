import { describe, expect, it, vi } from 'vitest';
import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { hasPermission, requireManageServer } from '../../src/utils/permissions.js';
import { fakeChatInputInteraction } from '../helpers/interaction.js';

function fakeMember(bitfield: bigint): GuildMember {
  return {
    permissions: { has: (perm: bigint) => (bitfield & perm) === perm },
  } as unknown as GuildMember;
}

describe('permissions', () => {
  it('grants access to members with Manage Server', () => {
    const member = fakeMember(PermissionFlagsBits.ManageGuild);
    expect(hasPermission(member)).toBe(true);
  });

  it('denies access to members without Manage Server', () => {
    const member = fakeMember(PermissionFlagsBits.SendMessages);
    expect(hasPermission(member)).toBe(false);
  });

  it('denies access to a missing member', () => {
    expect(hasPermission(null)).toBe(false);
  });

  describe('requireManageServer', () => {
    it('returns true when interaction.memberPermissions grants Manage Server', async () => {
      const i = fakeChatInputInteraction({
        rawMemberPermissions: PermissionFlagsBits.ManageGuild,
      });
      const result = await requireManageServer(i);
      expect(result).toBe(true);
      expect(i.reply).not.toHaveBeenCalled();
    });

    it('replies ephemerally and returns false when neither source grants Manage Server', async () => {
      const i = fakeChatInputInteraction({
        rawMemberPermissions: PermissionFlagsBits.SendMessages,
      });
      const result = await requireManageServer(i);
      expect(result).toBe(false);
      expect(i.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Manage Server') }),
      );
    });

    it('uses interaction.memberPermissions.has() as the fallback check', async () => {
      const i = fakeChatInputInteraction({});
      const permissions = { has: vi.fn().mockReturnValue(false) };
      Object.defineProperty(i, 'memberPermissions', { value: permissions });
      Object.defineProperty(i, 'member', { value: null });

      const result = await requireManageServer(i);

      expect(permissions.has).toHaveBeenCalled();
      expect(result).toBe(false);
      expect(i.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );
    });
  });
});
