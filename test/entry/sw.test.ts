import { it, expect } from '../default.setup.js';

describe('service worker', () => {
  const registrations: ServiceWorkerRegistration[] = [];
  const register = async (...args: Parameters<ServiceWorkerContainer['register']>) => {
    const reg = await window.navigator.serviceWorker.register(...args);
    registrations.push(reg);
    if (!reg.active) {
      await new Promise((resolve) => {
        window.navigator.serviceWorker.addEventListener('controllerchange', resolve);
      });
    }
  };

  it.afterEach(async () => {
    await Promise.all(registrations.map((reg) => reg.unregister()));
  });

  it('should register', async () => {
    await register('./sw.js');
    await expect((await fetch('/sw-status')).text()).resolves.toBe('sw ready!');
  });
});
