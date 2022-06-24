import Handle from './Handle.js';

export type SerializableValue =
  | number | boolean | string | null | undefined | bigint | Date | Error | RegExp | Handle
  | SerializableValue[] | { [K: string]: SerializableValue };

export interface SerializedValue {
  i: number; // ID
  n?: number | boolean | string | null;
  v?: 'undefined' | 'NaN' | 'Infinity' | '-Infinity' | '-0';
  b?: string; // BigInt
  u?: string; // URL
  d?: string; // Date
  r?: {
    p: string;
    f: string;
  }, // RegExp
  h?: number; // Handle ID
  e?: {
    n: string;
    m: string;
    c?: SerializedValue | undefined;
    s?: string | undefined;
  }; // Error
  a?: SerializedValue[]; // Array
  o?: {
    k: string;
    v: SerializedValue;
  }[]; // Object
}

const innerParseSerializedValue = (
  value: SerializedValue,
  handleTargets: unknown[],
  refs: Map<number, unknown>,
): unknown => {
  const { i } = value;
  if (refs.has(i)) return refs.get(i);

  if (value.a !== undefined) {
    const arr: unknown[] = [];
    refs.set(i, arr);
    value.a.forEach((e) => {
      arr.push(innerParseSerializedValue(e, handleTargets, refs));
    });
    return arr;
  }
  if (value.o !== undefined) {
    const obj: { [K: string]: unknown } = {};
    refs.set(i, obj);
    value.o.forEach(({ k, v }) => {
      obj[k] = innerParseSerializedValue(v, handleTargets, refs);
    });
    return obj;
  }
  if (value.e !== undefined) {
    const error = new Error(value.e.m);
    refs.set(i, error);
    error.name = value.e.n;
    if (value.e.c !== undefined) {
      error.cause = innerParseSerializedValue(value.e.c, handleTargets, refs) as Error;
    }
    if (value.e.s !== undefined) error.stack = value.e.s;
    return error;
  }

  let parsed: unknown;

  if (value.n !== undefined) {
    parsed = value.n;
  } else if (value.v !== undefined) {
    switch (value.v) {
      case 'undefined':
        parsed = undefined;
        break;
      case 'NaN':
        parsed = NaN;
        break;
      case 'Infinity':
        parsed = Infinity;
        break;
      case '-Infinity':
        parsed = -Infinity;
        break;
      case '-0':
        parsed = -0;
        break;
      default:
        throw new Error('Unexpected value.v');
    }
  } else if (value.b !== undefined) {
    parsed = BigInt(value.b);
  } else if (value.u !== undefined) {
    parsed = new URL(value.u);
  } else if (value.d !== undefined) {
    parsed = new Date(value.d);
  } else if (value.r !== undefined) {
    parsed = new RegExp(value.r.p, value.r.f);
  } else if (value.h !== undefined) {
    if (!(value.h in handleTargets)) {
      throw new Error('Unexpected handle');
    }
    parsed = handleTargets[value.h];
  } else {
    throw new Error('Unexpected value');
  }

  refs.set(i, parsed);
  return parsed;
};

export const parseSerializedValue = (
  value: SerializedValue,
  handleTargets: unknown[] = [],
) => (
  innerParseSerializedValue(value, handleTargets, new Map())
);

export const noFallback = Symbol('indicate no fallback value on serialize');

export const innerSerializeValue = (
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
  if (value instanceof URL) return { i, u: value.toJSON() };
  if (value instanceof Date) return { i, d: value.toJSON() };
  if (value instanceof RegExp) return { i, r: { p: value.source, f: value.flags } };
  if (value instanceof Handle) return { i, h: value.id };
  if (value instanceof Error) {
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

export const serializeValue = (
  value: unknown,
  fallback: SerializableValue | typeof noFallback = noFallback,
) => (
  innerSerializeValue(value, fallback, [])
);

export const parseEvaluateExpression = (expression: string): unknown => {
  const exp = expression.trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`return (${exp})`)();
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function(`return (${exp.replace(/^(async )?/, '$1function ')})`)();
    } catch {
      throw new Error('Passed function is not well-serializable!');
    }
  }
};
