export interface RouteMetaBase {
  type: 'route';
}

export interface RouteRequestMeta extends RouteMetaBase {
  id: number;
  hasBody: boolean;
  headersArray: { name: string, value: string }[];
  isNavigationRequest: boolean;
  method: string;
  resourceType: string;
  url: string;
}

export interface RouteAbortMeta extends RouteMetaBase {
  action: 'abort';
  id: number;
  resolveID: number;
  errorCode?: string;
}

export interface RouteContinueMeta extends RouteMetaBase {
  action: 'continue';
  id: number;
  resolveID: number;
  hasPostData: boolean;
  headers?: { [key: string]: string; };
  method?: string;
  url?: string;
}

export interface RouteFulfillMeta extends RouteMetaBase {
  action: 'fulfill';
  id: number;
  resolveID: number;
  hasBody: boolean;
  contentType?: string;
  headers?: { [key: string]: string; };
  path?: string;
  status?: number;
}

export interface RouteResolveMeta extends RouteMetaBase {
  action: 'resolve';
  id: number;
  resolveID: number;
  error?: string;
}

export interface RouteToggleMeta extends RouteMetaBase {
  action: 'toggle';
  to: 'on' | 'off';
}

export interface HandleMetaBase {
  type: 'handle';
  id: number;
  resolveID: number | null;
}

export interface HandleEvaluateMeta extends HandleMetaBase {
  action: 'evaluate';
  fn: string;
  arg: string; // serialized arg
  h: boolean; // return as a new handle
}

export interface HandleGetPropertiesMeta extends HandleMetaBase {
  action: 'get-properties';
}

export interface HandleGetPropertyMeta extends HandleMetaBase {
  action: 'get-property';
  name: string;
}

export interface HandleJsonValueMeta extends HandleMetaBase {
  action: 'json-value';
}

export interface HandleDisposeMeta extends HandleMetaBase {
  action: 'dispose';
}

export interface HandleResolveMeta extends HandleMetaBase {
  action: 'resolve';
  result: string; // serialized result
  error: boolean; // the result was thrown (not normally returned)
}

export type MessageInit<T> = {
  [K in keyof T as K extends 'type' ? never : K]: undefined extends T[K] ? T[K] | undefined : T[K];
};

export type RouteClientMeta =
  RouteAbortMeta | RouteContinueMeta | RouteFulfillMeta | RouteToggleMeta;
export type RouteServerMeta = RouteRequestMeta | RouteResolveMeta | RouteToggleMeta;

export type RouteMeta = RouteClientMeta | RouteServerMeta;
export const createRouteMeta = <T extends RouteMeta>(init: MessageInit<T>) => (
  JSON.stringify({ type: 'route', ...init })
);

export type HandleClientMeta =
  | HandleEvaluateMeta | HandleJsonValueMeta | HandleDisposeMeta
  | HandleGetPropertiesMeta | HandleGetPropertyMeta;
export type HandleServerMeta = HandleResolveMeta;

export type HandleMeta = HandleClientMeta | HandleServerMeta;
export const createHandleMeta = <T extends HandleMeta>(init: MessageInit<T>) => (
  JSON.stringify({ type: 'handle', ...init })
);

export type ClientMeta = RouteClientMeta | HandleClientMeta;
export const parseClientMeta: (msg: string) => ClientMeta = JSON.parse;

export type ServerMeta = RouteServerMeta | HandleServerMeta;
export const parseServerMeta: (msg: string) => ServerMeta = JSON.parse;
