import { createRouteMeta, parseServerMeta } from '../message.js';
import type RouteRequest from './RouteRequest.js';

export type RouteChain = (done: boolean) => Promise<void>;

export type FallbackOverrides = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string | ArrayBuffer | ArrayBufferView;
};

export default class Route {
  constructor(
    private readonly ws: WebSocket,
    private readonly id: number,
    private readonly req: RouteRequest,
  ) {}

  protected handleResolve: ((done: boolean) => void) | null = null;

  /**
   * @internal
   */
  startHandling() {
    return new Promise<boolean>((resolve) => {
      this.handleResolve = (done) => {
        this.handleResolve = null;
        resolve(done);
      };
    });
  }

  private assertNotHandled(): asserts this is { handleResolve: NonNullable<Route['handleResolve']> } {
    if (this.handleResolve === null) {
      throw new Error('Route is already handled!');
    }
  }

  private resolveID = 0;

  private async waitServerResolve() {
    const { resolveID } = this;
    this.resolveID += 1;
    await new Promise<void>((resolve, reject) => {
      const onMessage = ({ data }: MessageEvent) => {
        if (typeof data !== 'string') return;
        const meta = parseServerMeta(data);
        if (meta.type !== 'route'
          || !('action' in meta)
          || meta.action !== 'resolve'
          || meta.id !== this.id
          || meta.resolveID !== resolveID) return;
        this.ws.removeEventListener('message', onMessage);
        if (meta.error === undefined) {
          resolve();
        } else {
          reject(new Error(meta.error));
        }
      };
      this.ws.addEventListener('message', onMessage);
    });
  }

  /**
   * @internal
   */
  async innerContinue() {
    const {
      postData,
      headers,
      method,
      url,
    } = this.req.fallbackOverridesForContinue();
    const hasPostData = postData !== undefined && postData !== null;
    this.ws.send(createRouteMeta({
      action: 'continue',
      id: this.id,
      resolveID: this.resolveID,
      hasPostData,
      headers,
      method,
      url,
    }));
    if (hasPostData) this.ws.send(postData);
    await this.waitServerResolve();
  }

  async fallback(options?: FallbackOverrides) {
    this.assertNotHandled();
    this.req.applyFallbackOverrides(options);
    this.handleResolve(false);
  }

  async abort(errorCode?: string) {
    this.assertNotHandled();
    this.ws.send(createRouteMeta({
      action: 'abort',
      id: this.id,
      resolveID: this.resolveID,
      errorCode,
    }));
    await this.waitServerResolve();
    this.handleResolve(true);
  }

  async continue(options?: FallbackOverrides) {
    this.assertNotHandled();
    this.req.applyFallbackOverrides(options);
    await this.innerContinue();
    this.handleResolve(true);
  }

  async fulfill({
    body,
    contentType,
    headers,
    path,
    response,
    status,
  }: {
    body?: string | ArrayBufferLike | Blob | ArrayBufferView | null;
    contentType?: string;
    headers?: Record<string, string>;
    path?: string;
    response?: Response;
    status?: number;
  } = {}) {
    this.assertNotHandled();
    let fulfillBody = body;
    if (fulfillBody === undefined) {
      const responseAB = await response?.clone().arrayBuffer();
      if (responseAB && responseAB.byteLength > 0) {
        fulfillBody = responseAB;
      }
    }
    const hasBody = fulfillBody !== undefined && fulfillBody !== null;
    this.ws.send(createRouteMeta({
      action: 'fulfill',
      id: this.id,
      resolveID: this.resolveID,
      hasBody,
      contentType: contentType ?? response?.headers.get('Content-Type') ?? undefined,
      headers: headers ?? (
        response && [...response.headers]
          .reduce((acc: Record<string, string>, [key, value]) => {
            const lowerKey = key.toLowerCase();
            acc[lowerKey] = acc[lowerKey] ? `${acc[lowerKey]},${value}` : value;
            return acc;
          }, {})
      ),
      path,
      status: status ?? response?.status,
    }));
    if (hasBody) this.ws.send(fulfillBody as NonNullable<typeof fulfillBody>);
    await this.waitServerResolve();
    this.handleResolve(true);
  }

  request() {
    return this.req;
  }
}
