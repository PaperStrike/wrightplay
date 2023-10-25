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

    // Detect inject error
    script.addEventListener('error', () => {
      // eslint-disable-next-line no-console
      console.error('Failed to inject test script');
      resolve(1);
    }, { once: true });

    // Detect init error
    const onUncaughtError = () => {
      // eslint-disable-next-line no-console
      console.error('Uncaught error detected while initializing the tests');
      resolve(1);
    };
    window.addEventListener('error', onUncaughtError, { once: true });

    // Detect init end
    window.addEventListener(`__wrightplay_${uuid}_init__`, () => {
      window.removeEventListener('error', onUncaughtError);
    }, { once: true });

    // Detect test done
    window.addEventListener(`__wrightplay_${uuid}_done__`, ({ exitCode }) => {
      window.removeEventListener('error', onUncaughtError);
      resolve(exitCode);
    }, { once: true });

    // Inject
    script.src = '/stdin.js';
    script.type = 'module';
    document.head.append(script);
  })
);
