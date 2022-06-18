import { describe, it, expect } from '../default.setup.js';
import {
  pageRoute,
  pageUnroute,
  bypassFetch,
  Route,
} from '../../src/index.js';

describe('basic routing', () => {
  const float: Promise<unknown>[] = [];
  const routeCallback = (r: Route) => {
    float.push(r.fulfill({ body: 'routed' }));
  };

  it.afterEach(async () => {
    await expect(Promise.all(float)).resolves.not.toThrow();
    float.length = 0;
  });

  it('should route', async () => {
    await pageRoute('/route', routeCallback);
    await expect((await fetch('/route')).text()).resolves.toBe('routed');
    expect(float.length).toBe(1);
  });

  it('should route 1 time', async () => {
    await pageRoute('/route-1', routeCallback, { times: 1 });
    await expect((await fetch('/route-1')).text()).resolves.toBe('routed');
    expect((await fetch('/route-1')).status).toBe(404);
    expect(float.length).toBe(1);
  });

  it('should unroute handler', async () => {
    await pageRoute('/cancel-handler', (r) => {
      float.push(r.fulfill({ body: 'fallback' }));
    });
    await pageRoute('/cancel-handler', routeCallback);
    await expect((await fetch('/cancel-handler')).text()).resolves.toBe('routed');
    await pageUnroute('/cancel-handler', routeCallback);
    await expect((await fetch('/cancel-handler')).text()).resolves.toBe('fallback');
    expect(float.length).toBe(2);
  });

  it('should unroute all handlers for url', async () => {
    await pageRoute('/cancel-url', (r) => {
      float.push(r.fulfill({ body: 'fallback' }));
    });
    await pageRoute('/cancel-url', routeCallback);
    await expect((await fetch('/cancel-url')).text()).resolves.toBe('routed');
    await pageUnroute('/cancel-url');
    expect((await bypassFetch('/cancel-url')).status).toBe(404);
    expect(float.length).toBe(1);
  });

  it('should bypass route', async () => {
    await pageRoute('/bypass-test', routeCallback);
    expect((await fetch('/bypass-test')).status).toBe(200);
    expect((await bypassFetch('/bypass-test')).status).toBe(404);
    expect(float.length).toBe(1);
  });
});
