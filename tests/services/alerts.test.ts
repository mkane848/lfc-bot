import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendCriticalAlert } from '../../src/services/alerts.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendCriticalAlert', () => {
  it('does nothing when no webhook URL is configured', () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    sendCriticalAlert('alert: no webhook configured');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the message and error detail to the webhook', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://discord.example/webhook');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    sendCriticalAlert('alert: something broke', new Error('boom'));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://discord.example/webhook');
    const body = JSON.parse(init.body) as { content: string };
    expect(body.content).toContain('alert: something broke');
    expect(body.content).toContain('boom');
  });

  it('suppresses repeated alerts with the same message within the cooldown window', () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://discord.example/webhook');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    sendCriticalAlert('alert: repeated failure');
    sendCriticalAlert('alert: repeated failure');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
