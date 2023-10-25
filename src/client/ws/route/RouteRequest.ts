import type playwright from 'playwright-core';
import HostHandle from '../handle/HostHandle.js';
import { RouteRequestMeta } from '../../../common/ws/message.js';
import { FallbackOverrides } from './Route.js';

export default class RouteRequest {
  constructor(
    private readonly requestMeta: RouteRequestMeta,
    private readonly requestBody: ArrayBuffer | null,
    private readonly ws: WebSocket,
  ) {
    const { frame, serviceWorker } = requestMeta;
    if (frame !== null) HostHandle.share(frame, ws, this);
    if (serviceWorker !== null) HostHandle.share(serviceWorker, ws, this);
  }

  private fallbackOverrides: FallbackOverrides = {};

  /**
   * @internal
   */
  applyFallbackOverrides(overrides?: FallbackOverrides) {
    this.fallbackOverrides = { ...this.fallbackOverrides, ...overrides };
  }

  /**
   * @internal
   */
  fallbackOverridesForContinue() {
    return this.fallbackOverrides;
  }

  private cachedAllHeaders: Record<string, string> | undefined;

  allHeaders() {
    if (this.fallbackOverrides.headers) {
      return this.fallbackOverrides.headers;
    }

    this.cachedAllHeaders ??= this.requestMeta.headersArray
      .reduce((acc: Record<string, string>, cur) => {
        const lowerName = cur.name.toLowerCase();
        acc[lowerName] = acc[lowerName] ? `${acc[lowerName]},${cur.value}` : cur.value;
        return acc;
      }, {});
    return this.cachedAllHeaders;
  }

  frame() {
    if (this.requestMeta.frame === null) {
      throw new Error('Service Worker requests do not have an associated frame');
    }
    return new HostHandle<playwright.Frame>(this.requestMeta.frame, this.ws);
  }

  headerValue(name: string) {
    return this.allHeaders()[name.toLowerCase()];
  }

  headersArray() {
    if (this.fallbackOverrides.headers) {
      return Object.entries(this.fallbackOverrides.headers)
        .map(([name, value]) => ({ name, value }));
    }

    return this.requestMeta.headersArray;
  }

  isNavigationRequest() {
    return this.requestMeta.isNavigationRequest;
  }

  method() {
    return this.fallbackOverrides.method ?? this.requestMeta.method;
  }

  postData(): string | null {
    const fallbackPostData = this.fallbackOverrides.postData;
    if (fallbackPostData) {
      if (typeof fallbackPostData === 'string') return fallbackPostData;
      return new TextDecoder().decode(fallbackPostData);
    }

    return this.requestBody ? new TextDecoder().decode(this.requestBody) : null;
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  postDataJSON(): Object | null {
    const postData = this.postData();
    if (!postData) return null;

    const contentType = this.headerValue('content-type');
    if (contentType === 'application/x-www-form-urlencoded') {
      return [...new URLSearchParams(postData)]
        .reduce((acc: Record<string, string>, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});
    }

    try {
      // eslint-disable-next-line @typescript-eslint/ban-types
      return JSON.parse(postData) as Object | null;
    } catch {
      throw new Error(`POST data is not a valid JSON object: ${postData}`);
    }
  }

  postDataArrayBuffer(): ArrayBuffer | null {
    const fallbackPostData = this.fallbackOverrides.postData;
    if (fallbackPostData) {
      if (typeof fallbackPostData === 'string') {
        return new TextEncoder().encode(fallbackPostData).buffer;
      }
      if (ArrayBuffer.isView(fallbackPostData)) {
        return fallbackPostData.buffer;
      }
      return fallbackPostData;
    }

    return this.requestBody;
  }

  resourceType() {
    return this.requestMeta.resourceType;
  }

  serviceWorker() {
    if (this.requestMeta.serviceWorker === null) return null;
    return new HostHandle<playwright.Worker>(this.requestMeta.serviceWorker, this.ws);
  }

  url() {
    return this.fallbackOverrides.url ?? this.requestMeta.url;
  }
}
