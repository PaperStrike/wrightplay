/* eslint-disable no-restricted-syntax */
import { hold, report, createTAPReporter } from 'zora';
import { done, onInit } from '../../../src/client/api.js';

// Hold zora default run
hold();

// Record failed assertion
const tapReporter = createTAPReporter();
async function* record(stream: Parameters<typeof tapReporter>[0]) {
  let exitCode = 0;
  for await (const msg of stream) {
    if (msg.type === 'ASSERTION' && !msg.data.pass) {
      exitCode = 1;
    } else if (msg.type === 'ERROR') {
      done(1);
    } if (msg.type === 'TEST_END') {
      done(exitCode);
    }
    yield msg;
  }
}

onInit(async () => {
  // Run zora with piped reporter
  await report({
    reporter: (stream) => tapReporter(record(stream)),
  });
});
