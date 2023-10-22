import Handle from './Handle.js';
import { SerializableValue, SerializedValue } from './Serializable.js';

function isURL(obj: unknown, objStr: string): obj is URL {
  return obj instanceof URL || objStr === '[object URL]';
}

function isDate(obj: unknown, objStr: string): obj is Date {
  return obj instanceof Date || objStr === '[object Date]';
}

function isRegExp(obj: unknown, objStr: string): obj is RegExp {
  return obj instanceof RegExp || objStr === '[object RegExp]';
}

function isError(obj: unknown, objStr: string): obj is Error {
  return obj instanceof Error || objStr === '[object Error]';
}

export const noFallback = Symbol('indicate no fallback value on serialize');

const innerSerializeValue = (
  value: unknown,
  fallback: SerializableValue | typeof noFallback,
  visited: unknown[],
): SerializedValue => {
  const visitedIndex = visited.findIndex((v) => Object.is(value, v));
  if (visitedIndex !== -1) return { i: visitedIndex };
  const i = visited.length;
  visited.push(value);

  if (Object.is(value, -0)) return { i, v: '-0' };
  if (Object.is(value, NaN)) return { i, v: 'NaN' };
  if (typeof value === 'symbol' && value !== noFallback) return { i, v: 'undefined' };
  if (value === undefined) return { i, v: 'undefined' };
  if (value === Infinity) return { i, v: 'Infinity' };
  if (value === -Infinity) return { i, v: '-Infinity' };
  if (value === null) return { i, n: null };
  if (typeof value === 'number') return { i, n: value };
  if (typeof value === 'boolean') return { i, n: value };
  if (typeof value === 'string') return { i, n: value };
  if (typeof value === 'bigint') return { i, b: value.toString() };
  if (value instanceof Handle) return { i, h: value.id };
  const valueObjStr = Object.prototype.toString.call(value);
  if (isURL(value, valueObjStr)) return { i, u: value.toJSON() };
  if (isDate(value, valueObjStr)) return { i, d: value.toJSON() };
  if (isRegExp(value, valueObjStr)) return { i, r: { p: value.source, f: value.flags } };
  if (isError(value, valueObjStr)) {
    return {
      i,
      e: {
        n: value.name,
        m: value.message,
        c: innerSerializeValue(value.cause, fallback, visited),
        s: value.stack,
      },
    };
  }
  if (Array.isArray(value)) {
    return { i, a: value.map((e) => innerSerializeValue(e, fallback, visited)) };
  }
  if (typeof value === 'object') {
    return {
      i,
      o: Object.entries(value).map(([k, v]) => (
        { k, v: innerSerializeValue(v, fallback, visited) }
      )),
    };
  }
  if (fallback !== noFallback) {
    return innerSerializeValue(fallback, noFallback, visited);
  }
  throw new Error(`Unexpected value: ${String(value)}`);
};

export default function serializeValue(
  value: unknown,
  fallback: SerializableValue | typeof noFallback = noFallback,
) {
  return innerSerializeValue(value, fallback, []);
}
