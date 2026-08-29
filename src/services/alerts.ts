import { getLogger } from '../utils/logger.js';

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const lastSentAt = new Map<string, number>();

function toErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.message;
  }
  if (err === undefined) {
    return undefined;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return undefined;
  }
}

/**
 * Best-effort notification of a critical failure to a Discord webhook, if
 * DISCORD_ALERT_WEBHOOK_URL is configured. No-ops silently when unset, and
 * never throws — callers should not have to guard this.
 *
 * Repeated alerts with the same message are suppressed for a cooldown window
 * so a recurring failure (e.g. a digest that fails every run) can't spam the
 * channel.
 */
export function sendCriticalAlert(message: string, err?: unknown): void {
  const webhookUrl = process.env.DISCORD_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  const now = Date.now();
  const last = lastSentAt.get(message);
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) {
    return;
  }
  lastSentAt.set(message, now);

  const detail = toErrorMessage(err);
  const content = detail ? `🚨 ${message}\n\`\`\`${detail}\`\`\`` : `🚨 ${message}`;

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch((webhookErr: unknown) => {
    getLogger().error({ err: webhookErr }, 'Failed to send Discord alert webhook');
  });
}
