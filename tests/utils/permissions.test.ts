import { describe, expect, it } from 'vitest';
import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { hasPermission } from '../../src/utils/permissions.js';

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
});
