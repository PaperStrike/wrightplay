import { createRouteMeta, parseServerMeta } from '../message.js';
import type RouteRequest from './RouteRequest.js';

export type RouteChain = (done: boolean) => Promise<void>;

type OverridesForContinue = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string | ArrayBufferLike | Blob | ArrayBufferView | null;
};

export default class Route {
  constructor(
    private readonly ws: WebSocket,
    private readonly id: number,
    private readonly req: RouteRequest,
  ) {}

  private chain: RouteChain | null = null;

  private continueOverrides: OverridesForContinue | undefined;

  private resolveID = 0;

  /**
   * @internal
   */
  setChain(routeChain: RouteChain) {
    this.chain = routeChain;
  }

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
  async finalContinue() {
    const {
      postData,
      headers,
      method,
      url,
    } = this.continueOverrides || {};
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

  private async followChain(done: boolean) {
    const { chain } = this;
    if (!chain) return; // TODO: Error elsewhere
    this.chain = null;
    await chain(done);
  }

  async abort(errorCode?: string) {
    this.ws.send(createRouteMeta({
      action: 'abort',
      id: this.id,
      resolveID: this.resolveID,
      errorCode,
    }));
    await this.waitServerResolve();
    await this.followChain(true);
  }

  async continue(options: OverridesForContinue) {
    // Intended early throw
    if (!this.chain) {
      throw new Error('Route is already handled!');
    }
    this.continueOverrides = { ...this.continueOverrides, ...options };
    await this.followChain(false);
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
    await this.followChain(true);
  }

  request() {
    return this.req;
  }
}
