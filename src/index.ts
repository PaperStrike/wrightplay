import WSClient from './WS/WSClient.js';
import TestInitEvent from './event/TestInitEvent.js';
import TestDoneEvent from './event/TestDoneEvent.js';

import type Route from './WS/route/Route.js';
import type RouteRequest from './WS/route/RouteRequest.js';
import type RouteHandler from './WS/route/RouteHandler.js';
import type {
  RouteMatcher,
  RouteHandlerCallback,
  RouteOptions,
} from './WS/route/RouteHandler.js';

export {
  Route,
  RouteRequest,
  RouteHandler,
  RouteMatcher,
  RouteHandlerCallback,
  RouteOptions,
};

declare const WRIGHTPLAY_CLIENT_UUID: string;
const uuid = WRIGHTPLAY_CLIENT_UUID;

let doneCalled = false;
export const done = (exitCode: number) => {
  doneCalled = true;
  window.dispatchEvent(new TestDoneEvent(uuid, exitCode));
};

export type InitCallback = () => Promise<void> | void;
const initCallbackList: InitCallback[] = [];
window.addEventListener(TestInitEvent.getName(uuid), () => {
  initCallbackList
    .reduce(async (last, callback) => {
      await last;
      await callback();
    }, Promise.resolve())
    .catch((e) => {
      if (doneCalled) return;
      // eslint-disable-next-line no-console
      console.error(new Error(`an init callback threw an error: ${String(e)}`));
      done(1);
    });
}, { once: true });
export const onInit = (callback: InitCallback) => {
  initCallbackList.push(callback);
};

const wsClient = new WSClient(uuid);
export const pageRoute = wsClient.addRoute.bind(wsClient);
export const pageUnroute = wsClient.removeRoute.bind(wsClient);
export const bypassFetch = wsClient.bypassFetch.bind(wsClient);
export const { pageHandle, contextHandle } = wsClient;
