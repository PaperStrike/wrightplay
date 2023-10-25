import { describe, it, expect } from '../default.setup.js';
import { pageHandle } from '../../src/client/api.js';

describe('cross window serialize', () => {
  let contentWindow: typeof window;

  const iframe = document.createElement('iframe');
  it.beforeAll(async () => {
    await new Promise((resolve) => {
      iframe.src = '/test/handle/blank.html';
      iframe.addEventListener('load', resolve);
      document.body.append(iframe);
    });
    contentWindow = iframe.contentWindow as typeof window;
  });

  it.afterAll(async () => {
    iframe.remove();
  });

  it('should properly serialize cross-window URL', async () => {
    const backed = await pageHandle.evaluate(
      (_, passed) => passed,
      new contentWindow.URL('https://example.com/cross'),
    );
    expect(backed).toBeInstanceOf(URL);
    expect(backed.toJSON()).toBe('https://example.com/cross');
  });

  it('should properly serialize cross-window Date', async () => {
    const backed = await pageHandle.evaluate(
      (_, passed) => passed,
      new contentWindow.Date('2022-06-24T16:57:22.886Z'),
    );
    expect(backed).toBeInstanceOf(Date);
    expect(backed.toJSON()).toBe('2022-06-24T16:57:22.886Z');
  });

  it('should properly serialize cross-window RegExp', async () => {
    const backed = await pageHandle.evaluate(
      (_, passed) => passed,
      new contentWindow.RegExp('cross', 'g'),
    );
    expect(backed).toBeInstanceOf(RegExp);
    expect(backed).toEqual(/cross/g);
  });

  it('should properly serialize cross-window Error', async () => {
    const backed = await pageHandle.evaluate(
      (_, passed) => passed,
      new contentWindow.Error('cross'),
    );
    expect(backed).toBeInstanceOf(Error);
    expect(backed.message).toBe('cross');
  });
});
