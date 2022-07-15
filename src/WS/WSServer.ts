import type http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type playwright from 'playwright-core';
import {
  parseEvaluateExpression,
  parseSerializedValue,
  serializeValue,
  SerializedValue,
} from './handle/serializer.js';
import {
  RouteClientMeta,
  HandleClientMeta,
  parseClientMeta,
  createRouteMeta, createHandleMeta,
} from './message.js';

/**
 * WebSocket Server that processes messages from the page client into Playwright actions
 */
export default class WSServer {
  private readonly uuid: string;

  private readonly wss: WebSocketServer;

  private readonly context: playwright.BrowserContext;

  private client: WebSocket | undefined;

  constructor(uuid: string, server: http.Server, page: playwright.Page) {
    this.uuid = uuid;
    this.context = page.context();

    this.handleTargets = [page, this.context];

    this.wss = new WebSocketServer({
      server,
      path: '/__wrightplay__',
    });
    this.wss.on('connection', (ws) => {
      ws.addEventListener('message', (event) => {
        if (event.data !== uuid) return;
        ws.once('close', () => {
          this.client = undefined;
        });
        ws.addEventListener('message', this.onMessage);
        this.client = ws;
      }, { once: true });
    });
  }

  hasClient() {
    return this.client !== undefined;
  }

  async reset() {
    await this.unsetRoute();
    this.resetHandleTargets();
  }

  private readonly routeList: playwright.Route[] = [];

  private async unsetRoute() {
    await this.context.unroute('', this.handler);
    this.routeList.length = 0;
  }

  private async startRoute() {
    await this.context.route('', this.handler);
  }

  private bypassNextMessage = false;

  private readonly onMessage = ({ data, target }: WebSocket.MessageEvent) => {
    (async () => {
      if (this.bypassNextMessage) {
        this.bypassNextMessage = false;
        return;
      }
      if (typeof data !== 'string') {
        throw new TypeError(`Expecting string message, received: ${String(data)}`);
      }

      const meta = parseClientMeta(data);
      if (meta.type === 'route') {
        await this.handleRouteMessage(meta, target, data);
      } else if (meta.type === 'handle') {
        await this.handleHandleMessage(meta, target);
      }
    })()
      // eslint-disable-next-line no-console
      .catch(console.error);
  };

  private async handleRouteMessage(
    meta: RouteClientMeta,
    source: WebSocket,
    originalText: string,
  ) {
    if (meta.action === 'toggle') {
      if (meta.to === 'on') {
        await this.startRoute();
      } else if (meta.to === 'off') {
        await this.unsetRoute();
      }
      source.send(originalText);
      return;
    }

    let body: string | Buffer | undefined;
    if (('hasBody' in meta && meta.hasBody) || ('hasPostData' in meta && meta.hasPostData)) {
      this.bypassNextMessage = true;
      body = await new Promise<string | Buffer>((resolve) => {
        source.addEventListener('message', ({ data: postData }) => {
          if (!(typeof postData === 'string' || postData instanceof Buffer)) {
            throw new TypeError(`Expecting string or buffer, received: ${String(postData)}`);
          }
          resolve(postData);
        }, { once: true });
      });
    }

    let error: string | undefined;

    const route = this.routeList[meta.id];
    if (!route) {
      error = 'Route is already handled!';
    } else {
      try {
        switch (meta.action) {
          case 'abort':
            await route.abort(meta.errorCode);
            break;
          case 'continue': {
            const continueOptions: Parameters<playwright.Route['continue']>[0] = {};
            if (meta.headers !== undefined) continueOptions.headers = meta.headers;
            if (meta.method !== undefined) continueOptions.method = meta.method;
            if (meta.url !== undefined) continueOptions.url = meta.url;
            if (body !== undefined) continueOptions.postData = body;
            await route.continue(continueOptions);
            break;
          }
          default: {
            const fulfillOptions: Parameters<playwright.Route['fulfill']>[0] = {};
            if (meta.contentType !== undefined) fulfillOptions.contentType = meta.contentType;
            if (meta.headers !== undefined) fulfillOptions.headers = meta.headers;
            if (meta.path !== undefined) fulfillOptions.path = meta.path;
            if (meta.status !== undefined) fulfillOptions.status = meta.status;
            if (body !== undefined) fulfillOptions.body = body;
            await route.fulfill(fulfillOptions);
          }
        }
        delete this.routeList[meta.id];
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    source.send(createRouteMeta({
      action: 'resolve',
      id: meta.id,
      resolveID: meta.resolveID,
      error,
    }));
  }

  private readonly handler = (route: playwright.Route, request: playwright.Request) => {
    (async () => {
      const headersArray = await request.headersArray();
      const bypassHeaderIndex = headersArray.findIndex(({ name, value }) => (
        name === `bypass-${this.uuid}` && value === 'true'
      ));
      if (bypassHeaderIndex !== -1) {
        headersArray.splice(bypassHeaderIndex, 1);
        await route.continue({
          headers: headersArray.reduce((acc: Record<string, string>, { name, value }) => {
            acc[name] = acc[name] ? `${acc[name]},${value}` : value;
            return acc;
          }, {}),
        });
        return;
      }
      const { client } = this;
      if (!client || client.readyState !== WebSocket.OPEN) {
        await route.continue();
        return;
      }
      const bodyBuffer = request.postDataBuffer();
      const hasBody = bodyBuffer !== null;
      client.send(createRouteMeta({
        id: this.routeList.length,
        hasBody,
        headersArray,
        isNavigationRequest: request.isNavigationRequest(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      }));
      if (hasBody) {
        client.send(bodyBuffer);
      }
      this.routeList.push(route);
    })()
      // eslint-disable-next-line no-console
      .catch(console.error);
  };

  private readonly handleTargets: [playwright.Page, playwright.BrowserContext, ...unknown[]];

  private resetHandleTargets() {
    this.handleTargets.length = 2;
  }

  private createHandleID(target: unknown) {
    return this.handleTargets.push(target) - 1;
  }

  private async handleHandleMessage(meta: HandleClientMeta, source: WebSocket) {
    const { id, resolveID } = meta;
    let result: unknown;
    let error = false;
    if (!(id in this.handleTargets)) {
      error = true;
      result = new Error(`Unexpected handle, most likely ${id < this.handleTargets.length ? 'disposed' : 'internal error'}`);
    } else {
      const target = this.handleTargets[id];
      try {
        switch (meta.action) {
          case 'evaluate': {
            const fn = parseEvaluateExpression(meta.fn);
            const arg = parseSerializedValue(
              JSON.parse(meta.arg) as SerializedValue,
              this.handleTargets,
            );
            const returned: unknown = await (typeof fn === 'function' ? fn(target, arg) : fn);
            if (meta.h) {
              result = this.createHandleID(returned);
            } else {
              result = returned;
            }
            break;
          }
          case 'get-properties':
            if (target === undefined || target === null) {
              result = [];
            } else {
              result = Object.entries(target as Record<string, unknown>).map(([key, value]) => (
                [key, this.createHandleID(value)]
              ));
            }
            break;
          case 'get-property':
            result = this.createHandleID((target as Record<string, unknown>)[meta.name]);
            break;
          case 'dispose':
            delete this.handleTargets[id];
            break;
          default:
            result = target;
        }
      } catch (e) {
        error = true;
        result = e instanceof Error ? e : String(e);
      }
    }
    source.send(createHandleMeta({
      action: 'resolve',
      id,
      resolveID,
      result: JSON.stringify(serializeValue(result, null)),
      error,
    }));
  }
}
