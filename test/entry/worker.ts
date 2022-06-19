globalThis.addEventListener('message', ({ data }) => {
  globalThis.postMessage((data as number[]).reduce((a, b) => a + b));
});
