import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { SourceMapPayload } from 'node:module';

import playwright from 'playwright';
import { lookup as mimeLookup } from 'mrmime';
import getPort, { portNumbers } from 'get-port';
import esbuild from 'esbuild';
import sirv from 'sirv';

import '../common/utils/patchDisposable.js';
import EventEmitter from './utils/TypedEventEmitter.js';
import TestFinder from './TestFinder.js';
import BrowserLogger from './BrowserLogger.js';
import CoverageReporter from './CoverageReporter.js';
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

export interface FileServer extends http.Server {
  address(): AddressInfo;
}

export type BrowserServer = playwright.BrowserServer;

/**
 * Absolute path to static file directory.
 */
export const staticDir = fileURLToPath(new URL('../../static', import.meta.url));

export default class Runner implements Disposable {
  readonly cwd: string;

  /**
   * File to run before the test files.
   */
  readonly setupFile: string | undefined;

  /**
   * Test file finder and watcher.
   */
  readonly testFinder: TestFinder;

  /**
   * Additional entry points to build.
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
    watch = false,
    browser = 'chromium',
    browserServerOptions = {},
    headless = browserServerOptions.headless ?? !browserServerOptions.devtools,
    noCov = browser !== 'chromium',
  }: RunnerOptions) {
    this.setupFile = setup;
    this.entryPoints = entryPoints;
    this.watch = watch;
    this.browserType = browser;
    this.browserServerOptions = browserServerOptions;
    this.headless = headless;

    this.cwd = path.resolve(cwd);

    this.testFinder = new TestFinder({
      patterns: tests,
      cwd: this.cwd,
      watch: this.watch,
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
   * Pathname to built file hash & content map.
   * For instance, '/stdin.js' -> { text: 'console.log(1)' hash: 'xxx' }.
   */
  readonly fileContents: Map<string, { text: string, hash: string }> = new Map();

  /**
   * Pathname to source map payload map.
   * For instance, '/stdin.js' -> { version: 3, ... }.
   */
  readonly sourceMapPayloads: Map<string, SourceMapPayload> = new Map();

  private updateBuiltFiles(files: esbuild.OutputFile[]) {
    const { cwd, fileContents, sourceMapPayloads } = this;
    return files.reduce((changed, { path: absPath, hash, text }) => {
      const pathname = `/${path.relative(cwd, absPath)}`;

      // Skip unchanged files.
      const same = fileContents.get(pathname)?.hash === hash;
      if (same) return changed;

      fileContents.set(pathname, { text, hash });

      // Cache source maps for stack trace and coverage.
      if (pathname.endsWith('.map')) {
        sourceMapPayloads.set(
          pathname.slice(0, -4),
          JSON.parse(text) as SourceMapPayload,
        );
      }

      return true;
    }, false);
  }

  private readonly cwdRequestListener: http.RequestListener;

  private readonly staticRequestListener: http.RequestListener;

  async launchFileServer(): Promise<FileServer> {
    const {
      cwd,
      setupFile,
      testFinder,
      entryPoints,
      watch,
      fileContents,
      staticRequestListener,
    } = this;

    let building = true;
    const buildEventEmitter = new EventEmitter<{
      ready: [];
      changed: [buildCount: number];
    }>();
    const buildContext = await esbuild.context({
      entryPoints: {
        ...entryPoints,
        // The stdin API doesn't support onLoad callbacks,
        // so we use the entry point workaround.
        // https://github.com/evanw/esbuild/issues/720
        stdin: '<stdin>',
      },
      metafile: watch,
      bundle: true,
      format: 'esm',
      sourcemap: 'linked',
      outdir: './',
      absWorkingDir: cwd,
      define: { WRIGHTPLAY_CLIENT_UUID: `'${this.uuid}'` },
      plugins: [
        {
          name: 'import files loader',
          setup: (pluginBuild) => {
            pluginBuild.onResolve({ filter: /^<stdin>$/ }, () => ({ path: 'stdin', namespace: 'stdin' }));
            pluginBuild.onLoad({ filter: /^/, namespace: 'stdin' }, async () => {
              const importFiles = await testFinder.getFiles();
              if (setupFile) importFiles.unshift(setupFile.replace(/\\/g, '\\\\'));
              if (importFiles.length === 0) {
                if (watch) {
                  // eslint-disable-next-line no-console
                  console.error('No test file found');
                } else {
                  throw new Error('No test file found');
                }
              }
              const importStatements = importFiles.map((file) => `import '${file}'`).join('\n');
              return {
                contents: `${importStatements}\n(${clientRunner.init.toString()})('${this.uuid}')`,
                resolveDir: cwd,
              };
            });
          },
        },
        {
          name: 'built files updater',
          setup: (pluginBuild) => {
            let buildCount = 0;
            let lastBuildFailed = false;
            pluginBuild.onStart(() => {
              building = true;
            });
            pluginBuild.onEnd((result) => {
              building = false;
              buildCount += 1;
              const files = result.outputFiles!;
              const changed = this.updateBuiltFiles(files);
              buildEventEmitter.emit('ready'); // signals the http server to respond

              if (!watch) return;

              // Watch the errored files if any.
              // This may not help the cases where the error may be resolved
              // in another dir (TestFinder watches the dir instead of the file),
              // but still better than nothing.
              const watchFiles: string[] = [];
              result.errors.forEach((error) => {
                if (!error.location) return;
                watchFiles.push(error.location.file);
              });

              if (watchFiles.length > 0) {
                lastBuildFailed = true;
                testFinder.setRelevantFiles(watchFiles);
                return;
              }

              // Return if the built content remains unchanged and no recovery is needed.
              // Since built content remains the same during errors, we should identify a
              // successful rerun that can replace previous esbuild error messages with
              // the latest test results, even if the content has been run before.
              if (!changed && !lastBuildFailed) return;
              lastBuildFailed = false;

              // Watch the imported files.
              const { inputs } = result.metafile!;
              Object.values(inputs).forEach((input) => {
                input.imports.forEach((im) => {
                  if (im.external || im.path.startsWith('(disabled):')) return;
                  watchFiles.push(im.path.replace(/[?#].+$/, ''));
                });
              });

              testFinder.setRelevantFiles(watchFiles);

              // Emit the updated event so as to trigger a rerun
              buildEventEmitter.emit('changed', buildCount);
            });
          },
        },
      ],
      write: false,
    });

    if (watch) {
      testFinder.on('change', () => {
        buildContext.rebuild()
          // Do nothing as esbuild prints the errors itself
          .catch(() => {});
      });

      testFinder.updateFiles();
    } else {
      // Non-watch mode automatically triggers `updateFiles` on construction,
      // so we don't need to manually call it here.
      await buildContext.rebuild();
    }

    const esbuildListener: http.RequestListener = (request, response) => {
      const { url } = request as typeof request & { url: string };
      const pathname = url.split(/[?#]/, 1)[0];

      const handleRequest = () => {
        const builtContent = fileContents.get(pathname);
        if (!builtContent) {
          staticRequestListener(request, response);
          return;
        }

        const mimeType = mimeLookup(pathname) || '';
        response.writeHead(200, {
          'Content-Type': `${mimeType}; charset=utf-8`,
        });
        response.end(builtContent.text);
      };

      if (building) {
        buildEventEmitter.once('ready', handleRequest);
      } else {
        handleRequest();
      }
    };

    const server = http.createServer(esbuildListener) as FileServer;
    server.on('close', () => {
      buildContext.dispose()
        // Do nothing as esbuild prints the errors itself
        .catch(() => {});
    });

    // Forward file change event for the reruns.
    buildEventEmitter.on('changed', (count) => {
      // Bypass the first build.
      if (count === 1) return;
      server.emit('wrightplay:changed');
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
      return page.evaluate(clientRunner.inject, this.uuid)
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(error);
          return 1;
        });
    };

    await page.goto('/');

    // Rerun the tests on file changes.
    fileServer.on('wrightplay:changed', () => {
      page.reload().catch(() => {
        // eslint-disable-next-line no-console
        console.error('Failed to rerun the tests after file changes');
      });
    });

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
    page.on('load', () => {
      // Playwright has no direct and reliable API that listens to the initial load
      // or DOMContentLoaded events for the main frame only.
      // We use our own WebSocket connection to detect that.
      if (wsServer.hasClient()) return;
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

    if (!this.watch && this.headless) {
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

  [Symbol.dispose]() {
    this.testFinder[Symbol.dispose]();
  }
}
