/* eslint-disable max-len */
import { EventEmitter as BaseEventEmitter } from 'node:events';

// The values of the event map are the arguments passed to the event.
export type EventMap<T extends EventMap<T>> = Record<EventOf<T>, unknown[]>;

// Extract valid event names from an event map.
export type EventOf<T extends EventMap<T>> = Extract<keyof T, EventName>;

// The base EventEmitter only allows string | symbol as event names.
export type EventName = string | symbol;

export type ArbitraryEventMap = Record<EventName, unknown[]>;

interface EventEmitter<T extends EventMap<T> = ArbitraryEventMap> extends BaseEventEmitter {
  addListener<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  on<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  once<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  removeListener<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  off<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  removeAllListeners<K extends EventOf<T>>(event?: K): this;
  listeners<K extends EventOf<T>>(eventName: K): ((...args: T[K]) => void)[];
  rawListeners<K extends EventOf<T>>(eventName: K): ((...args: T[K]) => void)[];
  emit<K extends EventOf<T>>(eventName: K, ...args: T[K]): boolean;
  listenerCount<K extends EventOf<T>>(eventName: K): number;
  prependListener<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  prependOnceListener<K extends EventOf<T>>(eventName: K, listener: (...args: T[K]) => void): this;
  eventNames(): Array<EventOf<T>>;
}

export interface EventEmitterConstructor {
  new <T extends EventMap<T> = ArbitraryEventMap>(...args: ConstructorParameters<typeof BaseEventEmitter>): EventEmitter<T>;
  readonly prototype: EventEmitter<ArbitraryEventMap>;
}

// @ts-expect-error not assignable as we add type restrictions
// eslint-disable-next-line @typescript-eslint/no-redeclare
const EventEmitter: EventEmitterConstructor = BaseEventEmitter;

export default EventEmitter;
