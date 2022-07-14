import { RouteRequestMeta } from '../message.js';
import { FallbackOverrides } from './Route.js';

export default class RouteRequest {
  constructor(
    readonly requestMeta: RouteRequestMeta,
    readonly requestBody: Blob | null,
  ) {}

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

  postDataBlob() {
    const { postData } = this.fallbackOverrides;
    if (postData !== undefined) {
      if (postData === null) return postData;
      return new Blob([postData]);
    }

    return this.requestBody;
  }

  url() {
    return this.fallbackOverrides.url ?? this.requestMeta.url;
  }
}
