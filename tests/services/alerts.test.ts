import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function loadModule() {
  return import('../../src/services/alerts.js');
}

describe('sendCriticalAlert', () => {
  it('no-ops silently when DISCORD_ALERT_WEBHOOK_URL is unset', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', '');
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('boom-noop');

    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the webhook URL with the message when configured', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('boom-plain');

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toBe('🚨 boom-plain');
  });

  it('appends a code-fenced error detail when an Error is supplied', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('boom-error-detail', new Error('card not resolved'));

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toContain('boom-error-detail');
    expect(body.content).toContain('card not resolved');
    expect(body.content).toMatch(/```/);
  });

  it('uses the raw string when err is a string', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('boom-string-err', 'because reasons');

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toContain('because reasons');
  });

  it('serialises a structured error object as JSON', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('boom-object-err', { code: 'ENOENT', path: '/x' });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toContain('ENOENT');
    expect(body.content).toContain('/x');
  });

  it('drops unserialisable errors and posts just the message', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    sendCriticalAlert('boom-circular-err', circular);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toBe('🚨 boom-circular-err');
  });

  it('suppresses a repeat alert within the 5 minute cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('cooldown-deduped');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    sendCriticalAlert('cooldown-deduped');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    sendCriticalAlert('cooldown-deduped');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not suppress different messages within the cooldown window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    fetchMock.mockResolvedValue({ status: 204 });
    const { sendCriticalAlert } = await loadModule();

    sendCriticalAlert('cooldown-msg-A');
    sendCriticalAlert('cooldown-msg-B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logs but does not throw when the webhook fetch rejects', async () => {
    vi.stubEnv('DISCORD_ALERT_WEBHOOK_URL', 'https://example.test/webhook');
    const rejection = new Error('network down');
    fetchMock.mockRejectedValue(rejection);
    const { sendCriticalAlert } = await loadModule();

    expect(() => sendCriticalAlert('boom-fetch-fail')).not.toThrow();
  });
});
