import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { SourceMapPayload } from 'node:module';

import playwright from 'playwright-core';
import { globby } from 'globby';
import { lookup as mimeLookup } from 'mrmime';
import getPort, { portNumbers } from 'get-port';
import esbuild from 'esbuild';
import sirv from 'sirv';

import BrowserLogger from './BrowserLogger.js';
import CoverageReporter from './CoverageReporter.js';
import WSServer from './WS/WSServer.js';

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
   * @see [Entry points | esbuild - API]{@link https://esbuild.github.io/api/#entry-points}
   */
  entryPoints?: Record<string, string>;

  /**
   * Number of seconds the test build remains fresh after the test is built. Defaults to 2.
   */
  buildMaxAge?: number;

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

export interface FileServer extends http.Server {
  address(): AddressInfo;
}

export type BrowserServer = playwright.BrowserServer;

/**
 * Absolute path to static file directory.
 */
export const staticDir = fileURLToPath(new URL('../static', import.meta.url));

export default class Runner {
  readonly cwd: string;

  /**
   * File to run before the test files.
   */
  readonly setupFile: string | undefined;

  /**
   * Promise of an array of absolute test file paths.
   */
  readonly testFiles: Promise<string[]>;

  /**
   * Additional entry points to build.
   * @see [Entry points | esbuild - API]{@link https://esbuild.github.io/api/#entry-points}
   */
  readonly entryPoints: Record<string, string>;

  /**
   * Number of seconds the test build remains fresh after the test is built.
   */
  readonly buildMaxAge: number;

  /**
   * Type of the browser. One of: "chromium", "firefox", "webkit".
   */
  readonly browserType: BrowserTypeName;

  /**
   * Options used to launch the test browser server.
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
    buildMaxAge = 2,
    browser = 'chromium',
    browserServerOptions = {},
    headless = browserServerOptions.headless ?? !browserServerOptions.devtools,
    noCov = browser !== 'chromium',
  }: RunnerOptions) {
    this.setupFile = setup;
    this.entryPoints = entryPoints;
    this.buildMaxAge = buildMaxAge;
    this.browserType = browser;
    this.browserServerOptions = browserServerOptions;
    this.headless = headless;

    this.cwd = path.resolve(cwd);

    // Globby match test files.
    this.testFiles = globby(tests, {
      cwd: this.cwd,
      absolute: true,
      gitignore: true,
    });

    // Resolve coverage folder. Defaults to NODE_V8_COVERAGE
    if (!noCov && process.env.NODE_V8_COVERAGE) {
      this.reportCoverageDir = path.resolve(this.cwd, process.env.NODE_V8_COVERAGE);
    }

    this.cwdRequestListener = sirv(this.cwd, {
      dev: true,
    });
    this.staticRequestListener = sirv(staticDir, {
      dev: true,
      onNoMatch: this.cwdRequestListener,
    });
  }

  /**
   * Pathname to file content map.
   * For instance, '/stdin.js' -> 'console.log(1)'.
   */
  readonly fileContents: Map<string, string> = new Map();

  /**
   * Pathname to source map payload map.
   * For instance, '/stdin.js' -> { version: 3, ... }.
   */
  readonly sourceMapPayloads: Map<string, SourceMapPayload> = new Map();

  private updateBuiltFiles(files: esbuild.OutputFile[]) {
    const { cwd, fileContents, sourceMapPayloads } = this;
    files.forEach(({ path: absPath, text }) => {
      const pathname = `/${path.relative(cwd, absPath)}`;
      const changed = fileContents.get(pathname) !== text;
      fileContents.set(pathname, text);

      // Cache source maps for stack trace and coverage.
      if (changed && pathname.endsWith('.map')) {
        sourceMapPayloads.set(
          pathname.slice(0, -4),
          JSON.parse(text) as SourceMapPayload,
        );
      }
    });
  }

  private readonly cwdRequestListener: http.RequestListener;

  private readonly staticRequestListener: http.RequestListener;

  async launchFileServer(): Promise<FileServer> {
    const {
      cwd,
      setupFile,
      testFiles,
      entryPoints,
      buildMaxAge,
      fileContents,
      staticRequestListener,
    } = this;

    const importFiles = await testFiles;
    if (setupFile) importFiles.unshift(setupFile.replace(/\\/g, '\\\\'));
    if (importFiles.length === 0) {
      throw new Error('No test file found');
    }

    type BuildResult = Omit<esbuild.BuildResult, 'rebuild'> & {
      outputFiles: esbuild.OutputFile[];
      rebuild: Pick<esbuild.BuildInvalidate, keyof esbuild.BuildInvalidate> & {
        (): Promise<BuildResult>;
      };
    };
    let buildDate = 0;
    let building = true;
    let build = esbuild.build({
      stdin: {
        contents: `${importFiles.map((file) => `import '${file}'`).join('\n')}
window.dispatchEvent(new CustomEvent('__wrightplay_${this.uuid}_init__'))`,
        resolveDir: cwd,
      },
      entryPoints,
      bundle: true,
      format: 'esm',
      sourcemap: 'linked',
      outdir: './',
      absWorkingDir: cwd,
      define: { WRIGHTPLAY_CLIENT_UUID: `'${this.uuid}'` },
      plugins: [{
        name: 'built files updater',
        setup: (pluginBuild) => {
          pluginBuild.onEnd((result) => {
            this.updateBuiltFiles(result.outputFiles ?? []);
            buildDate = Date.now();
            building = false;
          });
        },
      }],
      write: false,
      incremental: true,
    })
      // eslint-disable-next-line no-console
      .catch(console.error) as Promise<BuildResult | void>;

    const esbuildListener: http.RequestListener = (request, response) => {
      const { url } = request as typeof request & { url: string };
      const pathname = url.split(/[?#]/, 1)[0];

      if (!building && Date.now() - buildDate > buildMaxAge * 1000) {
        building = true;
        build = build.then((result) => result?.rebuild());
      }

      build.then(() => {
        const builtContent = fileContents.get(pathname);
        if (!builtContent) {
          staticRequestListener(request, response);
          return;
        }

        const mimeType = mimeLookup(pathname) || '';
        response.writeHead(200, {
          'Content-Type': `${mimeType}; charset=utf-8`,
        });
        response.end(builtContent);
      })
        // eslint-disable-next-line no-console
        .catch(console.error);
    };

    const server = http.createServer(esbuildListener) as FileServer;
    server.on('close', () => {
      build
        .then((result) => result?.rebuild.dispose())
        // eslint-disable-next-line no-console
        .catch(console.error);
    });

    // This is helpful if one day esbuild Incremental API supports
    // exiting with the main process without calling dispose.
    // Currently it's just useless.
    server.unref();

    // Avoid browser blocked ports.
    const port = await getPort({ port: portNumbers(10081, 65535) });
    await new Promise<void>((resolve) => {
      server.listen(port, '127.0.0.1', resolve);
    });
    return server;
  }

  async launchBrowserServer(): Promise<BrowserServer> {
    const serverOptions: BrowserServerOptions = {
      ...this.browserServerOptions,
      headless: this.headless,
    };
    return playwright[this.browserType].launchServer(serverOptions);
  }

  /**
   * Start the tests and return the exit code.
   */
  async runTests(): Promise<number> {
    const fileServerLaunch = this.launchFileServer();

    // esbuild Incremental API will hang until dispose is called,
    // so be sure to dispose by closing the file server on errors.
    return this.runTestsForFileServerLaunch(fileServerLaunch)
      .catch(async (e) => {
        (await fileServerLaunch).close();
        throw e;
      });
  }

  /**
   * Start the tests and return the exit code.
   * Receive a file server promise to help the outer function to
   * close the file server even on errors.
   */
  async runTestsForFileServerLaunch(
    fileServerLaunch: Promise<FileServer>,
  ): Promise<number> {
    // const [fileServer, browserServer] = await Promise.all([
    //   this.launchFileServer(),
    //   this.launchBrowserServer(),
    // ]);
    const [fileServer, browserServer] = await Promise.all([
      fileServerLaunch,
      this.launchBrowserServer(),
    ]);
    const browser = await playwright[this.browserType].connect(browserServer.wsEndpoint());
    const { port } = fileServer.address();
    const baseURL = `http://127.0.0.1:${port}`;
    const page = await browser.newPage({
      baseURL,
    });

    const { cwd, browserType, sourceMapPayloads } = this;
    const bLog = new BrowserLogger({
      cwd,
      browserType,
      sourceMapPayloads,
      originalStackBase: baseURL,
    });

    // Forward browser console messages.
    page.on('console', bLog.forwardConsole);
    page.on('pageerror', bLog.forwardError);

    const wsServer = new WSServer(this.uuid, fileServer, page);
    const run = async () => {
      await wsServer.reset();
      return page.evaluate((uuid) => (
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
      ), this.uuid)
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(error);
          return 1;
        });
    };

    await page.goto('/');

    // Record coverage if required.
    // Only support chromium atm.
    const recordingCoverage = this.reportCoverageDir
      ? await page.coverage.startJSCoverage()
        .then(() => true)
        .catch(() => {
          // eslint-disable-next-line no-console
          console.error(`Failed to use Coverage APIs on ${this.browserServerOptions.channel ?? browserType} ${browser.version()}`);
          return false;
        })
      : false;

    let exitCodePromise = run();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      exitCodePromise = run();
    });

    // Wait the first run.
    // The tests may run multiple times in headed mode.
    await exitCodePromise;

    // Report coverage of the first run if recording.
    // We only record the first run even in headed mode
    // since we can't get coverage data on page close, which may happen at any time in that mode.
    if (recordingCoverage) {
      const coverageResult = await page.coverage.stopJSCoverage();
      const coverageReporter = new CoverageReporter(coverageResult, {
        cwd,
        sourceMapPayloads,
        pid: browserServer.process().pid as number,
      });
      await coverageReporter.save(this.reportCoverageDir as string);
    }

    if (this.headless) {
      page.off('console', bLog.forwardConsole);
      page.off('pageerror', bLog.forwardError);
      await bLog.lastPrint;
      await page.close();
    } else if (!page.isClosed()) {
      await page.waitForEvent('close', { timeout: 0 });
    }

    await browserServer.close();
    fileServer.close();

    return exitCodePromise;
  }
}
