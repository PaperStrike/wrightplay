import { RouteRequestMeta } from '../message.js';

export default class RouteRequest {
  constructor(
    readonly requestMeta: RouteRequestMeta,
    readonly requestBody: Blob | null,
  ) {}

  private cachedAllHeaders: Record<string, string> | undefined;

  allHeaders() {
    this.cachedAllHeaders ??= this.requestMeta.headersArray
      .reduce((acc: Record<string, string>, cur) => {
        const lowerName = cur.name.toLowerCase();
        acc[lowerName] = acc[lowerName] ? `${acc[lowerName]},${cur.value}` : cur.value;
        return acc;
      }, {});
    return this.cachedAllHeaders;
  }

  headersArray() {
    return this.requestMeta.headersArray;
  }

  isNavigationRequest() {
    return this.requestMeta.isNavigationRequest;
  }

  method() {
    return this.requestMeta.method;
  }

  postDataBlob() {
    return this.requestBody;
  }

  url() {
    return this.requestMeta.url;
  }
}
