import {
  createHandleMeta,
  parseServerMeta,
  HandleMetaBase,
  HandleClientMeta,
} from '../message.js';
import * as Serializer from '../../serializer/index.js';

export type Unboxed<Arg> =
  Arg extends URL
    ? URL
    : Arg extends Date
      ? Date
      : Arg extends RegExp
        ? RegExp
        : Arg extends Error
          ? Error
          : Arg extends HostHandle<infer T>
            ? T
            : Arg extends [infer A0, ...infer Rest]
              ? [Unboxed<A0>, ...Unboxed<Rest>]
              : Arg extends object
                ? { [Key in keyof Arg]: Unboxed<Arg[Key]> }
                : Arg;
export type NodeFunctionOn<On, Arg2, R> =
  string | ((on: On, arg2: Unboxed<Arg2>) => R | Promise<R>);

type HandleClientMetaInit<T> = {
  [K in keyof T as K extends keyof HandleMetaBase ? never : K]: T[K];
};

const idReferenceCounts: number[] = [];
const finalizationRegistry = new FinalizationRegistry(({ id, ws }: {
  id: number;
  ws: WebSocket;
}) => {
  if (idReferenceCounts[id] > 1) {
    idReferenceCounts[id] -= 1;
    return;
  }
  delete idReferenceCounts[id];
  if (ws.readyState !== ws.OPEN) return;
  ws.send(createHandleMeta({
    id,
    resolveID: null,
    action: 'dispose',
  }));
});

export default class HostHandle<T = unknown> extends Serializer.Handle {
  /**
   * Share the handle ID with an object so that the matching handles will keep referencing the node
   * target until all ID users are disposed or garbage-collected.
   * @internal
   */
  static share(id: number, ws: WebSocket, withObj: object) {
    idReferenceCounts[id] = (idReferenceCounts[id] ?? 0) + 1;
    finalizationRegistry.register(withObj, { id, ws });
  }

  constructor(
    id: number,
    private readonly ws: WebSocket,
  ) {
    super(id);

    idReferenceCounts[id] = (idReferenceCounts[id] ?? 0) + 1;
    finalizationRegistry.register(this, { id, ws }, this);
  }

  private resolveID = 0;

  private async act<R>(
    init: HandleClientMetaInit<HandleClientMeta>,
    convertResult: (result: unknown) => R,
  ): Promise<R> {
    const { ws, id, resolveID } = this;
    this.resolveID += 1;
    if (ws.readyState === ws.CONNECTING) {
      await new Promise((resolve) => {
        ws.addEventListener('open', resolve);
      });
    }
    ws.send(createHandleMeta({
      id,
      resolveID,
      ...init,
    }));
    return new Promise<R>((resolve, reject) => {
      const controller = new AbortController();
      ws.addEventListener('message', ({ data }) => {
        if (typeof data !== 'string') return;
        const meta = parseServerMeta(data);
        if (meta.type !== 'handle'
          || meta.id !== id
          || meta.resolveID !== resolveID) return;
        controller.abort();
        const result = Serializer.parseSerializedValue(
          JSON.parse(meta.result) as Serializer.SerializedValue,
        );
        if (meta.error) {
          reject(result);
        } else {
          resolve(convertResult(result));
        }
      }, { signal: controller.signal });
    });
  }

  private innerEvaluate<R, Arg, O>(
    nodeFunction: NodeFunctionOn<O, Arg, R>,
    arg: Arg,
    createHandle: false,
  ): Promise<R>;
  private innerEvaluate<R, Arg, O>(
    nodeFunction: NodeFunctionOn<O, Arg, R>,
    arg: Arg,
    createHandle: true,
  ): Promise<HostHandle<R>>;
  private async innerEvaluate<R, Arg, O>(
    nodeFunction: NodeFunctionOn<O, Arg, R>,
    arg: Arg,
    createHandle: boolean,
  ): Promise<R | HostHandle<R>> {
    return this.act({
      action: 'evaluate',
      fn: String(nodeFunction),
      arg: JSON.stringify(Serializer.serializeValue(arg)),
      h: createHandle,
    }, (result) => {
      if (createHandle) return new HostHandle(result as number, this.ws);
      return result as R;
    });
  }

  evaluate<R, Arg, O extends T = T>(nodeFunction: NodeFunctionOn<O, Arg, R>, arg: Arg): Promise<R>;
  evaluate<R, O extends T = T>(nodeFunction: NodeFunctionOn<O, void, R>, arg?: unknown): Promise<R>;
  async evaluate<R, Arg, O>(nodeFunction: NodeFunctionOn<O, Arg, R>, arg: Arg) {
    return this.innerEvaluate(nodeFunction, arg, false);
  }

  evaluateHandle<R, Arg, O extends T = T>(
    nodeFunction: NodeFunctionOn<O, Arg, R>,
    arg: Arg,
  ): Promise<HostHandle<R>>;
  evaluateHandle<R, O extends T = T>(
    nodeFunction: NodeFunctionOn<O, void, R>,
    arg?: unknown,
  ): Promise<HostHandle<R>>;
  async evaluateHandle<R, Arg, O>(nodeFunction: NodeFunctionOn<O, Arg, R>, arg: Arg) {
    return this.innerEvaluate(nodeFunction, arg, true);
  }

  async jsonValue(): Promise<T> {
    return this.act({
      action: 'json-value',
    }, (result) => result as T);
  }

  private disposed = false;

  async dispose(): Promise<void> {
    if (this.disposed) return;
    const { id } = this;
    if (idReferenceCounts[id] > 1) {
      idReferenceCounts[id] -= 1;
    } else {
      await this.act({
        action: 'dispose',
      }, () => {});
      delete idReferenceCounts[id];
    }
    finalizationRegistry.unregister(this);
    this.disposed = true;
  }

  async getProperties(): Promise<Map<string, HostHandle>> {
    return this.act({
      action: 'get-properties',
    }, (result) => {
      const propertiesMap: Map<string, HostHandle> = new Map();
      (result as [string, number][]).forEach(([name, handleID]) => {
        propertiesMap.set(name, new HostHandle(handleID, this.ws));
      });
      return propertiesMap;
    });
  }

  async getProperty(propertyName: string): Promise<HostHandle> {
    return this.act({
      action: 'get-property',
      name: propertyName,
    }, (result) => new HostHandle(result as number, this.ws));
  }
}
