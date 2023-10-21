import { describe, expect, it } from '../default.setup.js';
import Handle from '../../src/WS/handle/Handle.js';
import {
  noFallback,
  serializeValue,
  parseSerializedValue,
  SerializableValue,
  SerializedValue,
} from '../../src/WS/handle/serializer.js';

describe('serializer', () => {
  function parse<T extends SerializableValue>(
    value: T,
    handleTargets?: unknown[],
    fallback?: SerializableValue,
  ): T;
  function parse(
    value: unknown,
    handleTargets: unknown[],
    fallback: SerializableValue,
  ): SerializableValue;
  function parse(
    value: unknown,
    handleTargets?: unknown[],
  ): never;
  function parse(
    value: unknown,
    handleTargets: unknown[] = [],
    fallback: SerializableValue | typeof noFallback = noFallback,
  ) {
    return parseSerializedValue(
      JSON.parse(JSON.stringify(serializeValue(value, fallback))) as SerializedValue,
      handleTargets,
    );
  }

  it('should properly serialize normal number, boolean, string, and null', () => {
    expect(parse(16)).toBe(16);
    expect(parse('hello')).toBe('hello');
    expect(parse(false)).toBe(false);
    expect(parse(null)).toBe(null);
  });

  it('should properly serialize undefined, NaN, Infinity, -Infinity, and -0', () => {
    expect(parse(undefined)).toBe(undefined);
    expect(parse(NaN)).toBe(NaN);
    expect(parse(Infinity)).toBe(Infinity);
    expect(parse(-Infinity)).toBe(-Infinity);
    expect(parse(-0)).toBe(-0);
  });

  it('should serialize symbols as undefined', () => {
    expect(parse(Symbol('unserializable but acceptable'))).toBe(undefined);
  });

  it('should properly serialize BigInt', () => {
    const bi = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
    expect(parse(bi)).toBe(bi);
  });

  it('should properly serialize URL', () => {
    const url = new URL('https://example.com/');
    const parsed = parse(url);
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed.toJSON()).toBe(url.toJSON());
  });

  it('should properly serialize Date', () => {
    const date = new Date('2022-06-17T17:56:43.674Z');
    const parsed = parse(date);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toJSON()).toBe(date.toJSON());
  });

  it('should properly serialize regex', () => {
    const regex = parse(/regex/i);
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.source).toBe('regex');
    expect(regex.flags).toBe('i');
  });

  it('should properly serialize handle', () => {
    const handle = new Handle(2);
    expect(parse(handle, [7, 8, 9, 10])).toBe(9);
  });

  it('should properly serialize basic error', () => {
    const error = new RangeError('the error');
    const parsed = parse(error);
    expect(parsed).toBeInstanceOf(Error);
    expect(parsed.name).toBe('RangeError');
    expect(parsed.message).toBe('the error');
    expect(parsed.stack).toBe(error.stack);
  });

  it('should properly serialize error cause', () => {
    const cause = new TypeError('the inner cause');
    const error = new RangeError('the outer error');
    error.cause = cause;
    const parsed = parse(error);
    expect(parsed).toBeInstanceOf(Error);
    expect(parsed.name).toBe('RangeError');
    expect(parsed.message).toBe('the outer error');
    expect(parsed.stack).toBe(error.stack);
    expect(parsed.cause).toBeInstanceOf(Error);
    expect((parsed.cause as Error).name).toBe('TypeError');
    expect((parsed.cause as Error).message).toBe('the inner cause');
    expect((parsed.cause as Error).stack).toBe(cause.stack);
  });

  it('should properly serialize array and object', () => {
    const arr = [1, ['deep', { deeper: [] }]];
    expect(parse(arr)).toEqual(arr);
  });

  it('should work for circular references', () => {
    const arr: SerializableValue = [1, ['deep', { deeper: [] }]];
    arr.push(arr);
    expect(parse(arr)).toEqual(arr);
  });

  it('should throw for functions', () => {
    expect(() => serializeValue(() => {})).toThrow('Unexpected value');
  });

  it('should use provided fallback value', () => {
    expect(parse([1, () => {}, 3], [], null)).toEqual([1, null, 3]);
  });

  it('should throw if provided fallback value is also unexpected', () => {
    expect(() => serializeValue(() => {}, (() => {}) as unknown as SerializableValue))
      .toThrow('Unexpected value');
  });
});
