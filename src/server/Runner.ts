import path from 'node:path';
import { randomUUID } from 'node:crypto';

import playwright from 'playwright';

import '../common/utils/patchDisposable.js';
import BrowserLogger from './BrowserLogger.js';
import CoverageReporter from './CoverageReporter.js';
import TestServer from './TestServer.js';
import WSServer from './ws/WSServer.js';
import * as clientRunner from '../client/runner.js';

export type BrowserTypeName = 'chromium' | 'firefox' | 'webkit';

export type BrowserServerOptions = NonNullable<Parameters<playwright.BrowserType['launchServer']>[0]>;

export interface RunnerOptions {
  /**
   * Current working directory. Defaults to `process.cwd()`
   */
  cwd?: string;

  /**
   * File to run before the test files.
   */
  setup?: string;

  /**
   * Test files.
   */
  tests: string | string[];

  /**
   * Additional entry points to build. The output name must be explicitly specified.
   * You can use this option to build workers.
   * @see [Entry points | esbuild - API](https://esbuild.github.io/api/#entry-points)
   */
  entryPoints?: Record<string, string>;

  /**
   * Monitor test file changes and trigger automatic test reruns.
   * Defaults to `false`.
   */
  watch?: boolean;

  /**
   * Type of the browser. One of: "chromium", "firefox", "webkit". Defaults to "chromium".
   */
  browser?: BrowserTypeName;

  /**
   * Options used to launch the test browser server. Defaults to the Playwright defaults.
   * @see playwright.BrowserType.launchServer
   */
  browserServerOptions?: BrowserServerOptions;

  /**
   * Whether to run browser in headless mode. Defaults to `true` unless the
   * `browserServerOptions.devtools` option is `true`.
   * @see BrowserServerOptions.headless
   */
  headless?: boolean;

  /**
   * Disable coverage file output. This only matters when `NODE_V8_COVERAGE` is set.
   * Defaults to `false` on chromium, `true` on firefox and webkit.
   */
  noCov?: boolean;
}

export type BrowserServer = playwright.BrowserServer;

export default class Runner {
  readonly cwd: string;

  /**
   * File to run before the test files.
   */
  readonly setupFile: string | undefined;

  /**
   * Test file patterns.
   */
  readonly testPatterns: string | string[];

  /**
   * Additional entry points to build. The output name must be explicitly specified.
   * You can use this option to build workers.
   * @see [Entry points | esbuild - API](https://esbuild.github.io/api/#entry-points)
   */
  readonly entryPoints: Record<string, string>;

  /**
   * Monitor test file changes and trigger automatic test reruns.
   */
  readonly watch: boolean;

  /**
   * Type of the browser. One of: "chromium", "firefox", "webkit".
   */
  readonly browserType: BrowserTypeName;

  /**
   * Options used to launch the test browser server. Defaults to the Playwright defaults.
   * @see playwright.BrowserType.launchServer
   */
  readonly browserServerOptions: BrowserServerOptions;

  /**
   * Whether to run browser in headless mode.
   * @see BrowserServerOptions.headless
   */
  readonly headless: boolean;

  /**
   * Directory to save the coverage output file. Defaults to `NODE_V8_COVERAGE`
   * unless noCov option is `true`.
   */
  readonly reportCoverageDir: string | undefined;

  /**
   * UUID for communications between Node and in-page scripts.
   */
  readonly uuid = randomUUID();

  constructor({
    cwd = process.cwd(),
    setup,
    tests,
    entryPoints = {},
    watch = false,
    browser = 'chromium',
    browserServerOptions = {},
    headless = browserServerOptions.headless ?? !browserServerOptions.devtools,
    noCov = browser !== 'chromium',
  }: RunnerOptions) {
    this.setupFile = setup;
    this.testPatterns = tests;
    this.entryPoints = entryPoints;
    this.watch = watch;
    this.browserType = browser;
    this.headless = headless;

    this.cwd = path.resolve(cwd);

    this.browserServerOptions = {
      ...browserServerOptions,
      headless,
    };

    // Resolve coverage folder. Defaults to NODE_V8_COVERAGE
    if (!noCov && process.env.NODE_V8_COVERAGE && browser === 'chromium') {
      this.reportCoverageDir = path.resolve(this.cwd, process.env.NODE_V8_COVERAGE);
    }
  }

  /**
   * Start the tests and return the exit code.
   */
  async runTests(): Promise<number> {
    await using stack = new AsyncDisposableStack();

    const testServer = stack.use(new TestServer({
      cwd: this.cwd,
      setup: this.setupFile,
      tests: this.testPatterns,
      entryPoints: this.entryPoints,
      watch: this.watch,
      uuid: this.uuid,
    }));

    const [addressInfo, browserServer] = await Promise.all([
      testServer.launch(),
      playwright[this.browserType].launchServer(this.browserServerOptions),
    ]);
    stack.defer(() => browserServer.close());

    const browser = await playwright[this.browserType].connect(browserServer.wsEndpoint());
    stack.defer(() => browser.close());

    const { address, port } = addressInfo;
    const baseURL = `http://${address}:${port}`;
    const browserContext = await browser.newContext({
      baseURL,
    });
    stack.defer(() => browserContext.close());

    // Create the page to run the tests.
    // This is intentionally created before the browser logger to avoid
    // the page being disposed before the logger has finished.
    // You can take it as the logger somehow depends on the page.
    const page = await browserContext.newPage();
    stack.defer(() => page.close());

    const { cwd, browserType } = this;
    const { sourceMapPayloads, httpServer } = testServer;
    const bLog = stack.use(new BrowserLogger({
      browserType,
      browserContext,
      sourceMapPayloads,
      originalStackBase: baseURL,
    }));

    // Forward browser console messages.
    bLog.startForwarding();

    const wsServer = stack.use(new WSServer(this.uuid, httpServer, page));
    const run = async () => {
      using runStack = new DisposableStack();

      // Listen to the file change event during the test run to
      // ignore the evaluate error caused by automatic test reruns.
      let fileChanged = false;
      const fileChangeListener = () => { fileChanged = true; };
      testServer.once('changed', fileChangeListener);
      runStack.defer(() => { testServer.off('changed', fileChangeListener); });

      try {
        await wsServer.reset();
        return await page.evaluate(clientRunner.inject, this.uuid);
      } catch (error) {
        // Skip the error print if the file has changed.
        // eslint-disable-next-line no-console
        if (!fileChanged) console.error(error);
        return 1;
      }
    };

    await page.goto('/');

    // Rerun the tests on file changes.
    testServer.on('changed', () => {
      // Reload the page to rerun the tests.
      page.reload({ waitUntil: 'commit' })
        .catch(() => {
          // eslint-disable-next-line no-console
          console.error('Failed to rerun the tests after file changes');
        });
    });

    // Record coverage if required.
    // Only support chromium atm.
    if (this.reportCoverageDir) {
      await page.coverage.startJSCoverage();
    }

    let exitCodePromise = run();
    page.on('load', () => {
      // Playwright has no direct and reliable API that listens to the initial load
      // or DOMContentLoaded events for the main frame only.
      // We use our own WebSocket connection to detect that.
      if (wsServer.hasClient()) return;
      exitCodePromise = run();
    });

    // Wait the first run.
    // The tests may run multiple times in headed / watch mode.
    await exitCodePromise;

    // Stop coverage recording and save the report.
    // We only record the first run even in headed / watch mode since
    // we can't get coverage data after the page is closed, and the
    // close time is totally unpredictable in headed / watch mode.
    if (this.reportCoverageDir) {
      const coverageResult = await page.coverage.stopJSCoverage();
      const coverageReporter = new CoverageReporter(coverageResult, {
        cwd,
        sourceMapPayloads,
        pid: browserServer.process().pid!,
      });
      await coverageReporter.save(this.reportCoverageDir);
    }

    // In headed / watch mode, wait for the browser to close.
    if (this.watch || !this.headless) {
      await page.waitForEvent('close', { timeout: 0 });
    }

    return exitCodePromise;
  }
}
