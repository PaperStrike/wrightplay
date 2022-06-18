import process from 'process';
import { done } from '../../../src/index.js';

globalThis.process = process;

const { onFailure, onFinish } = await import('tape');

let exitCode = 0;
onFailure(() => {
  exitCode = 1;
});
onFinish(() => {
  done(exitCode);
});
