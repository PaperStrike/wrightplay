import util from 'util';
import { SourceMap, SourceMapPayload } from 'module';

import chalk from 'chalk';
import type { BrowserContext, ConsoleMessage, WebError } from 'playwright';

import '../common/utils/patchDisposable.js';

/**
 * Playwright protocol type to console level mappings.
 * Used to map playwright page console message types.
 */
export const protocolTypeToConsoleLevel = {
  dir: 'dir',
  log: 'log',
  debug: 'debug',
  info: 'info',
  error: 'error',
  warning: 'warn',
  dirxml: 'dirxml',
  table: 'table',
  trace: 'trace',
  clear: 'clear',
  startGroup: 'group',
  startGroupCollapsed: 'groupCollapsed',
  endGroup: 'groupEnd',
  assert: 'assert',
  profile: 'profile',
  profileEnd: 'profileEnd',
  count: 'count',
  countReset: 'countReset',
  timeLog: 'timeLog',
  timeEnd: 'timeEnd',
  timeStamp: 'timeStamp',
} as const;

export type ProtocolType = keyof typeof protocolTypeToConsoleLevel;

export interface BrowserLogOptions {
  /**
   * Browser type affects the output stack trace strings.
   *
   * Chromium-based browsers use the same format as Node.js, prefixing the trace with `    at `.
   * Firefox and webkit prefix the trace with `@`.
   * Chromium-based and firefox prefix uncaught errors with `Uncaught `, while webkit not.
   */
  browserType?: 'chromium' | 'firefox' | 'webkit';

  /**
   * The browser context that the logger is attached to.
   */
  browserContext?: BrowserContext;

  /**
   * Pathname to source map payload map.
   * For instance, '/stdin.js' -> { version: 3, ... }.
   * Used to map error stack traces; can be dynamically updated.
   */
  sourceMapPayloads?: ReadonlyMap<string, SourceMapPayload>;

  /**
   * The base URL of file paths for mapping. Defaults to `http://127.0.0.1`
   */
  originalStackBase?: URL | string;
}

export interface PrintOptions {
  level?: typeof protocolTypeToConsoleLevel[ProtocolType];
  color?: (text: string) => string;
}

export default class BrowserLogger implements AsyncDisposable {
  readonly browserType: 'chromium' | 'firefox' | 'webkit';

  /**
   * The browser context that the logger is attached to.
   */
  readonly browserContext: BrowserContext | undefined;

  /**
   * The prefix of stack traces in the target browser.
   * Chromium-based prefix stack trace paths with `    at ` (4-spaces, word "at", 1-space),
   * while firefox and webkit prefix with `@` (a single "@" sign).
   */
  readonly stackTracePrefix: string;

  /**
   * The prefix of uncaught errors in the target browser.
   * Chromium-based and firefox prefix uncaught errors with `Uncaught ` (word "Uncaught", 1 space),
   * while webkit not.
   */
  readonly uncaughtErrorPrefix: string;

  /**
   * Pathname to source map payload map.
   * For instance, '/stdin.js' -> { version: 3, ... }.
   */
  readonly sourceMapPayloads: ReadonlyMap<string, SourceMapPayload>;

  /**
   * The base URL of file paths for mapping.
   * For instance, `http://127.0.0.1:8001`
   */
  readonly originalStackBase: URL | string;

  /**
   * The regex for trace matching.
   * For instance, `/(http:\/\/127.0.0.1:8001\/.+|(?<= \().+):(\d+):(\d+)/g`.
   */
  readonly stackTraceRegex: RegExp;

  constructor({
    browserType = 'chromium',
    browserContext,
    sourceMapPayloads = new Map(),
    originalStackBase = 'http://127.0.0.1',
  }: BrowserLogOptions = {}) {
    this.browserType = browserType;
    this.browserContext = browserContext;
    this.stackTracePrefix = browserType === 'chromium' ? '    at ' : '@';
    this.uncaughtErrorPrefix = browserType === 'webkit' ? '' : 'Uncaught ';

    this.sourceMapPayloads = sourceMapPayloads;
    this.originalStackBase = originalStackBase;

    const baseDir = new URL('./', originalStackBase).href;

    // `(?<= \().+`: Mocha (and/or other tools) may change the stack and omit the base path
    this.stackTraceRegex = new RegExp(`(${baseDir}.+|(?<= \\().+):(\\d+):(\\d+)`, 'g');
  }

  /**
   * Cache source map consumers for performance.
   */
  readonly sourceMapCache: WeakMap<SourceMapPayload, SourceMap> = new WeakMap();

  /**
   * Create a new string that uses mapped stack traces.
   * Requires and maps to 1-based stack trace lines and columns.
   */
  mapStack(text: string) {
    const {
      stackTraceRegex,
      sourceMapPayloads,
      sourceMapCache,
    } = this;

    return text.replace(stackTraceRegex, (original, url: string, line: string, column: string) => {
      // Get the latest built content.
      let pathname;
      try {
        ({ pathname } = new URL(url, this.originalStackBase));
      } catch {
        return original;
      }

      // Return the original if no payload matched.
      const payload = sourceMapPayloads.get(pathname);
      if (!payload) return original;

      let sourceMap = sourceMapCache.get(payload);
      if (!sourceMap) {
        sourceMap = new SourceMap(payload);
        sourceMapCache.set(payload, sourceMap);
      }

      /**
       * Get the mapped position.
       * Note that the source map specification uses 0-based lines and columns,
       * while the error stack ones are 1-based.
       */
      const {
        originalSource,
        originalLine,
        originalColumn,
      } = sourceMap.findEntry(+line - 1, +column - 1);

      // The return type of `findEntry` is inaccurate. It may return {}.
      if (originalSource === undefined) {
        return original;
      }

      return `${originalSource}:${originalLine + 1}:${originalColumn + 1}`;
    });
  }

  private lastPrint: Promise<void> = Promise.resolve();

  /**
   * Print messages to console with specified log level and color.
   */
  printWithOptions(
    {
      level = 'log',
      color,
    }: PrintOptions,
    messages: unknown[] | Promise<unknown[]>,
  ) {
    // eslint-disable-next-line no-console
    const logFn = console[level] as (...args: unknown[]) => void;

    this.lastPrint = Promise.all([messages, this.lastPrint])
      .then(([msgList]) => {
        if (level === 'table') {
          if (color) {
            // eslint-disable-next-line no-console
            console.warn('color option is ignored when using table logger');
          }
          logFn(...msgList);
          return;
        }

        const formatted = color
          ? color(util.format(...msgList))
          : util.formatWithOptions({ colors: true }, ...msgList);

        logFn(this.mapStack(formatted));
      });
  }

  /**
   * Print messages to console.
   */
  readonly print = this.printWithOptions.bind(this, {});

  /**
   * An alias for print (console.log). Future behavior may change.
   */
  readonly info = this.printWithOptions.bind(this, { level: 'info' });

  /**
   * An alias for print (console.log). Future behavior may change.
   */
  readonly debug = this.printWithOptions.bind(this, { level: 'debug' });

  /**
   * Print warnings to console, in yellow.
   */
  readonly warn = this.printWithOptions.bind(this, { level: 'warn', color: chalk.yellowBright });

  /**
   * Print errors to console, in red.
   */
  readonly error = this.printWithOptions.bind(this, { level: 'error', color: chalk.redBright });

  /**
   * Print a playwright browser message to console.
   * Some types of messages don't yet work well (and may never).
   * @see [[BUG] console.count/countEnd event has wrong args in chromium/webkit, wrong text in firefox, and wrong type in webkit · Issue #10604 · microsoft/playwright](https://github.com/microsoft/playwright/issues/10604)
   */
  readonly forwardConsole = (message: ConsoleMessage) => {
    const protocolType = message.type() as ProtocolType;
    const level = protocolTypeToConsoleLevel[protocolType];

    switch (level) {
      case 'clear':
      case 'profile':
      case 'profileEnd':
      case 'timeStamp':
        return;
      case 'dir':
      case 'dirxml':
      case 'count':
      case 'countReset':
      case 'timeLog':
      case 'timeEnd':
        this.print([message.text()]);
        return;
      case 'assert': {
        const { url, lineNumber, columnNumber } = message.location();
        this.error([
          'Assertion failed: console.assert',
          `\b\n${this.stackTracePrefix}${url}:${lineNumber + 1}:${columnNumber + 1}`,
        ]);
        return;
      }
      default:
    }

    const text = message.text();
    const argHandles = message.args();

    // Browser messages may come without any argument handles.
    if (text && argHandles.length === 0) {
      switch (level) {
        case 'info':
        case 'debug':
        case 'warn':
        case 'error':
          this[level]([text]);
          break;
        default:
          this.print([text]);
      }
      return;
    }

    const argsPromise = (async () => {
      if (argHandles.length === 0) {
        return [];
      }

      /**
       * Parse the type of the first argument and the JSON presentation of each argument.
       * `evaluate` does the exact same serialize steps as `jsonValue` but a lot quicker
       * here as it can serialize a bunch at the same time.
       * Circular references are supported on Playwright >= 1.22 but undocumented yet.
       * @see import('playwright').JSHandle.jsonValue
       */
      const [firstIsString, args = []] = await argHandles[0].evaluate(
        (firstArg, passedArgs: unknown[]) => [typeof firstArg === 'string', passedArgs],
        argHandles,
      );

      /**
       * If the first arg is not a string but mapped to a string, escape `%`.
       * @see [Console string substitutions | MDN](https://developer.mozilla.org/en-US/docs/Web/API/console#using_string_substitutions)
       */
      if (!firstIsString && typeof args[0] === 'string') {
        args[0] = args[0].replace(/%/g, '%%');
      }

      return args;
    })()
      // Fallback to the original message text.
      .catch(() => [`[Incomplete] ${text}`]);

    switch (level) {
      case 'info':
      case 'debug':
      case 'warn':
      case 'error':
        this[level](argsPromise);
        break;
      case 'table':
      case 'group':
      case 'groupCollapsed':
      case 'groupEnd':
        this.printWithOptions({ level }, argsPromise);
        break;
      case 'trace': {
        const { url, lineNumber, columnNumber } = message.location();
        this.print(
          argsPromise.then((args) => [
            ...args,
            `\b\n${this.stackTracePrefix}${url}:${lineNumber + 1}:${columnNumber + 1}`,
          ]),
        );
        break;
      }
      default:
        this.print(argsPromise);
    }
  };

  /**
   * Print a playwright browser error to console.
   */
  readonly forwardError = (webError: WebError) => {
    const error = webError.error();

    // Leave errors without stack info as they are.
    if (!error.stack) {
      this.error([error]);
      return;
    }

    // Prefix with "uncaught" and use browser style prefix.
    this.error([
      this.uncaughtErrorPrefix + error.stack.replace(
        /(?<=^|\n) {4}at /g,
        this.stackTracePrefix,
      ),
    ]);
  };

  startForwarding() {
    if (!this.browserContext) return;
    this.browserContext.on('console', this.forwardConsole);
    this.browserContext.on('weberror', this.forwardError);
  }

  pauseForwarding() {
    if (!this.browserContext) return;
    this.browserContext.off('console', this.forwardConsole);
    this.browserContext.off('weberror', this.forwardError);
  }

  async stopForwarding() {
    this.pauseForwarding();
    await this.lastPrint;
  }

  [Symbol.asyncDispose]() {
    return this.stopForwarding();
  }
}
