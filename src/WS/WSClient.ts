import type playwright from 'playwright-core';
import {
  createRouteMeta,
  parseServerMeta,
  RouteServerMeta,
} from './message.js';
import RouteHandler, { RouteHandlerCallback, RouteMatcher, RouteOptions } from './route/RouteHandler.js';
import RouteRequest from './route/RouteRequest.js';
import Route from './route/Route.js';
import NodeHandle from './handle/NodeHandle.js';

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
    this.pageHandle = new NodeHandle(0, this.ws);
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
   * Resolve at a later message.
   */
  private statusResolve: null | ((status: 'on' | 'off') => void) = null;

  private async toggleServerRoute(status: 'on' | 'off') {
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
    let body: Blob | undefined;
    if (meta.hasBody) {
      this.bypassNextMessage = true;
      body = await new Promise<Blob>((resolve) => {
        this.ws.addEventListener('message', (bodyEvent) => {
          if (!(bodyEvent.data instanceof Blob)) {
            throw new TypeError(`Expecting blob request body, received: ${String(bodyEvent.data)}`);
          }
          resolve(bodyEvent.data);
        }, { once: true });
      });
    }
    const request = new RouteRequest(meta, body ?? null);
    const route = new Route(this.ws, meta.id, request);
    const requestURL = new URL(meta.url, window.location.origin);
    const handlers = this.routes.filter((r) => r.matches(requestURL));
    const handleNext = async () => {
      const handler = handlers.shift();
      if (!handler) {
        await route.finalContinue();
        return;
      }
      if (handler.willExpire()) {
        this.routes.splice(this.routes.indexOf(handler), 1);
      }
      await new Promise<void>((resolve) => {
        handler.handle(route, request, async (done) => {
          if (!done) {
            await handleNext();
          }
          resolve();
        });
      });
    };
    await handleNext();
    if (this.routes.length === 0) {
      await this.toggleServerRoute('off');
    }
  }

  readonly pageHandle: NodeHandle<playwright.Page>;
}
