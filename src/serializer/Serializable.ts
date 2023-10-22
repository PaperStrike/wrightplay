import Handle from './Handle.js';

export type SerializableValue =
  | number | boolean | string | null | undefined | bigint | URL | Date | Error | RegExp | Handle
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
