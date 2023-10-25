import { SerializedValue } from './Serializable.js';

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

export default function parseSerializedValue(
  value: SerializedValue,
  handleTargets: unknown[] = [],
) {
  return innerParseSerializedValue(value, handleTargets, new Map());
}
