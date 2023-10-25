import process from 'process';
import { done } from '../../../src/client/api.js';

globalThis.process = process;

const { onFailure, onFinish } = await import('tape');

let exitCode = 0;
onFailure(() => {
  exitCode = 1;
});
onFinish(() => {
  done(exitCode);
});
