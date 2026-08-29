import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { adminAuditLog, type AdminAuditLogRow, type NewAdminAuditLogRow } from '../db/schema.js';

export interface AdminActionInput {
  serverId: string;
  adminId: string;
  adminUsername: string;
  action: string;
  details?: Record<string, unknown>;
}

/** Record an admin command invocation for the server's audit trail. */
export function recordAdminAction(entry: AdminActionInput): void {
  const row: NewAdminAuditLogRow = {
    serverId: entry.serverId,
    adminId: entry.adminId,
    adminUsername: entry.adminUsername,
    action: entry.action,
    details: entry.details ? JSON.stringify(entry.details) : null,
    createdAt: Date.now(),
  };
  getDb().insert(adminAuditLog).values(row).run();
}

/** Return the most recent admin actions for a server, newest first. */
export function listRecentAdminActions(serverId: string, limit = 10): AdminAuditLogRow[] {
  return getDb()
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.serverId, serverId))
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(limit)
    .all();
}
