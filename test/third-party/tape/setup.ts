import process from 'process';
import { done } from 'wrightplay';

globalThis.process = process;

const { onFailure, onFinish } = await import('tape');

let exitCode = 0;
onFailure(() => {
  exitCode = 1;
});
onFinish(() => {
  done(exitCode);
});
