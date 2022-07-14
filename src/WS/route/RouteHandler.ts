import globToRegex from '../../util/globToRegex.js';
import type Route from './Route.js';
import type RouteRequest from './RouteRequest.js';

export type RouteMatcher = string | RegExp | ((url: URL) => boolean);
export type RouteHandlerCallback = (route: Route, request: RouteRequest) => void;
export interface RouteOptions {
  times?: number;
}

/**
 * We use multiple handlers and chain them on client, while using one single handler on server,
 * for performance. If one day the match or chain algorithm becomes complex enough, switch to
 * use 1:1 mappings.
 */
export default class RouteHandler {
  private handledCount = 0;

  private readonly maxHandleCount: number;

  private readonly parsedMatcher: (url: URL) => boolean;

  constructor(
    readonly url: RouteMatcher,
    readonly handler: RouteHandlerCallback,
    options: RouteOptions = {},
  ) {
    this.maxHandleCount = options.times ?? Infinity;

    /**
     * @see [urlMatches, playwright/netUtils.ts]{@link https://github.com/microsoft/playwright/blob/76abb3a5be7cab43e97c49bac099d6eb7da9ef98/packages/playwright-core/src/common/netUtils.ts#L107}
     */
    if (url === '') {
      this.parsedMatcher = () => true;
    } else if (typeof url === 'string') {
      const parsedRegex = globToRegex((
        url.startsWith('*') ? url : new URL(url, window.location.origin).href
      ));
      this.parsedMatcher = ({ href }: URL) => parsedRegex.test(href);
    } else if (url instanceof RegExp) {
      this.parsedMatcher = ({ href }: URL) => url.test(href);
    } else if (typeof url !== 'function') {
      throw new Error('url parameter should be string, RegExp or function');
    } else {
      this.parsedMatcher = url;
    }
  }

  /**
   * Not "expired" to avoid handler callback errors affecting related algorithm
   */
  willExpire() {
    return this.handledCount + 1 >= this.maxHandleCount;
  }

  matches(url: URL) {
    return this.parsedMatcher(url);
  }

  handle(route: Route, request: RouteRequest): Promise<boolean> {
    this.handledCount += 1;
    const handlePromise = route.startHandling();
    this.handler(route, request);
    return handlePromise;
  }
}
