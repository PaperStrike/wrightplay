/**
 * Functions to be injected into the test page to control the client test runs.
 *
 * Keep these funcs self-contained so that they can be serialized and injected.
 */

// No coverage support for this kind of functions yet
/* c8 ignore start */

/**
 * Dispatches an init event after the test scripts are successfully imported.
 */
export const init = (uuid: string) => {
  window.dispatchEvent(new CustomEvent(`__wrightplay_${uuid}_init__`));
};

/**
 * Injects the test script and resolves with the exit code.
 */
export const inject = (uuid: string) => (
  new Promise<number>((resolve) => {
    const script = document.createElement('script');

    // Avoid test interfering
    // eslint-disable-next-line no-console
    const consoleError = console.error;

    // Detect inject error
    script.addEventListener('error', () => {
      consoleError('Failed to inject test script');
      resolve(1);
    }, { once: true });

    // Detect init error
    const initErrorListenerAbortController = new AbortController();
    window.addEventListener('error', () => {
      consoleError('Uncaught error detected while initializing the tests');
      resolve(1);
    }, { once: true, signal: initErrorListenerAbortController.signal });

    // Detect init end
    window.addEventListener(`__wrightplay_${uuid}_init__`, () => {
      initErrorListenerAbortController.abort();
    }, { once: true });

    // Detect test done
    window.addEventListener(`__wrightplay_${uuid}_done__`, ({ exitCode }) => {
      initErrorListenerAbortController.abort();
      resolve(exitCode);
    }, { once: true });

    // Inject
    script.src = '/__wrightplay__/stdin.js';
    script.type = 'module';
    document.head.append(script);
    document.head.removeChild(script);
  })
);
