/**
 * uvu has no reliable or future-proof way to run and get the test results programmatically yet.
 * @see [Improve Programmatic Usage · Issue #113 · lukeed/uvu]{@link https://github.com/lukeed/uvu/issues/113}
 */
/* eslint-disable no-console */
import { onInit, done } from '../../../src/client/api.js';

let total: number | undefined;
let passed: number | undefined;
let skipped: number | undefined;

const updateIfFound = (str: string, regex: RegExp, original: number | undefined) => {
  const numStr = str.match(regex)?.[1];
  return numStr ? Number(numStr) : original;
};

const originalLog = console.log;
console.log = new Proxy(originalLog, {
  apply(target, thisArg, argArray: unknown[]) {
    const msg = argArray[0];
    if (typeof msg === 'string') {
      total = updateIfFound(msg, / +Total: +(\d+)/, total);
      passed = updateIfFound(msg, / +Passed: +(\d+)/, passed);
      skipped = updateIfFound(msg, / +Skipped: +(\d+)/, skipped);
      if (total !== undefined && passed !== undefined && skipped !== undefined && / Duration: /.test(msg)) {
        console.log = originalLog;
        done(total - passed - skipped > 0 ? 1 : 0);
      }
    }
    return target.apply(thisArg, argArray);
  },
});

// Proxy console.log before importing uvu.
const uvuImport = import('uvu');

onInit(async () => {
  const { test } = await uvuImport;
  test.run();
});
