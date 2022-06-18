import { it, expect } from '../default.setup.js';

describe('service worker', () => {
  it('should register', async () => {
    const container = window.navigator.serviceWorker;
    if (!(await container.register('./sw.js')).active) {
      await new Promise((resolve) => {
        container.addEventListener('controllerchange', resolve);
      });
    }
    await expect((await fetch('/sw-status')).text()).resolves.toBe('sw ready!');
  });
});
