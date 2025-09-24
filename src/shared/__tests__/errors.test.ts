import { createExtensionError, formatErrorLog } from '../errors';

describe('shared errors', () => {
  test('createExtensionError returns normalized object', () => {
    const error = createExtensionError('QUEUE_TIMEOUT', 'タイムアウト', { tabId: 1 });
    expect(error).toEqual({
      code: 'QUEUE_TIMEOUT',
      message: 'タイムアウト',
      detail: { tabId: 1 },
    });
  });

  test('formatErrorLog produces structured log arguments', () => {
    const args = formatErrorLog('QUEUE_TIMEOUT', '失敗', { retries: 3 });
    expect(args[0]).toEqual({ code: 'QUEUE_TIMEOUT', detail: { retries: 3 } });
    expect(args[1]).toBe('失敗');
  });
});
