import type playwright from 'playwright';
import {
  createRouteMeta,
  parseServerMeta,
  type RouteServerMeta,
} from '../../common/ws/message.js';
import RouteHandler, { type RouteHandlerCallback, type RouteMatcher, type RouteOptions } from './route/RouteHandler.js';
import RouteRequest from './route/RouteRequest.js';
import Route from './route/Route.js';
import HostHandle from './handle/HostHandle.js';

export default class WSClient {
  private readonly uuid: string;

  private readonly ws = new WebSocket(`ws://${window.location.host}/__wrightplay__`, 'route');

  public readonly wsReady: Promise<void>;

  constructor(uuid: string) {
    this.uuid = uuid;
    this.wsReady = new Promise<void>((resolve) => {
      this.ws.addEventListener('open', () => {
        this.ws.send(uuid);
        this.ws.addEventListener('message', this.onMessage);
        resolve();
      }, { once: true });
    });
    this.pageHandle = new HostHandle(0, this.ws);
    this.contextHandle = new HostHandle(1, this.ws);
  }

  private routes: RouteHandler[] = [];

  async addRoute(
    url: RouteMatcher,
    handler: RouteHandlerCallback,
    options: RouteOptions = {},
  ) {
    this.routes.unshift(new RouteHandler(url, handler, options));
    if (this.routes.length === 1) {
      await this.toggleServerRoute('on');
    }
  }

  async removeRoute(url: RouteMatcher, handler?: RouteHandlerCallback) {
    this.routes = this.routes.filter((route) => (
      route.url !== url || (handler !== undefined && route.handler !== handler)
    ));
    if (this.routes.length === 0) {
      await this.toggleServerRoute('off');
    }
  }

  /**
   * Promise of the current status switching.
   */
  private statusPromise = Promise.resolve();

  /**
   * Resolve status at a later message.
   */
  private statusResolve: null | ((status: 'on' | 'off') => void) = null;

  private async toggleServerRoute(status: 'on' | 'off') {
    const { statusPromise } = this;
    this.statusPromise = (async () => {
      await statusPromise.catch(() => {});
      const response = new Promise<'on' | 'off'>((resolve) => {
        this.statusResolve = resolve;
      });
      await this.wsReady;
      this.ws.send(createRouteMeta({
        action: 'toggle',
        to: status,
      }));
      if (await response !== status) {
        throw new Error(`Server failed to switch ${status}`);
      }
    })();
    return this.statusPromise;
  }

  bypassFetch(...fetchArgs: Parameters<typeof fetch>) {
    const request = new Request(...fetchArgs);
    request.headers.set(`bypass-${this.uuid}`, 'true');
    return fetch(request);
  }

  private bypassNextMessage = false;

  private readonly onMessage = ({ data }: MessageEvent) => {
    (async () => {
      if (this.bypassNextMessage) {
        this.bypassNextMessage = false;
        return;
      }
      if (typeof data !== 'string') {
        throw new TypeError(`Expecting string message, received: ${String(data)}`);
      }

      const meta = parseServerMeta(data);
      if (meta.type === 'route') {
        await this.handleRouteMessage(meta);
      }
    })()
      // eslint-disable-next-line no-console
      .catch(console.error);
  };

  private async handleRouteMessage(meta: RouteServerMeta) {
    if ('action' in meta) {
      if (meta.action === 'resolve') return;
      if (this.statusResolve === null) {
        throw new Error('Unexpected status message without calling to switch status');
      }
      this.statusResolve(meta.to);
      this.statusResolve = null;
      return;
    }
    let body: ArrayBuffer | undefined;
    if (meta.hasBody) {
      this.bypassNextMessage = true;
      const bodyBlob = await new Promise<Blob>((resolve) => {
        this.ws.addEventListener('message', (bodyEvent) => {
          if (!(bodyEvent.data instanceof Blob)) {
            throw new TypeError(`Expecting blob request body, received: ${String(bodyEvent.data)}`);
          }
          resolve(bodyEvent.data);
        }, { once: true });
      });
      body = await bodyBlob.arrayBuffer();
    }
    const request = new RouteRequest(meta, body ?? null, this.ws);
    const route = new Route(this.ws, meta.id, request);
    const requestURL = new URL(meta.url, window.location.origin);
    const handlers = this.routes.filter((r) => r.matches(requestURL));

    // eslint-disable-next-line no-restricted-syntax
    for (const handler of handlers) {
      if (handler.willExpire()) {
        this.routes.splice(this.routes.indexOf(handler), 1);
      }
      // eslint-disable-next-line no-await-in-loop
      const handled = await handler.handle(route, request);
      if (this.routes.length === 0) {
        this.toggleServerRoute('off').catch(() => {});
      }
      if (handled) return;
    }
    await route.innerContinue();
  }

  readonly pageHandle: HostHandle<playwright.Page>;

  readonly contextHandle: HostHandle<playwright.BrowserContext>;
}
