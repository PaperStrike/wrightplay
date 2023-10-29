import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { SourceMapPayload } from 'node:module';

import { lookup as mimeLookup } from 'mrmime';
import getPort, { portNumbers } from 'get-port';
import esbuild from 'esbuild';
import sirv from 'sirv';

import '../common/utils/patchDisposable.js';
import EventEmitter from './utils/TypedEventEmitter.js';
import TestFinder from './TestFinder.js';
import * as clientRunner from '../client/runner.js';

export interface FileServerOptions {
  cwd: string;
  setup: string | undefined;
  tests: string | string[];
  entryPoints: Record<string, string>;
  watch: boolean;
  uuid: string;
}

export interface FileServerEventMap {
  ready: [];
  changed: [];
}

/**
 * Absolute path to static file directory.
 */
export const staticDir = fileURLToPath(new URL('../../static', import.meta.url));

interface HttpServer extends http.Server {
  address(): AddressInfo | null;
}

export default class TestServer extends EventEmitter<FileServerEventMap>
  implements AsyncDisposable {
  /**
   * Absolute path to the working directory.
   */
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
   * Additional entry points to build.
   * @see [Entry points | esbuild - API](https://esbuild.github.io/api/#entry-points)
   */
  readonly entryPoints: Record<string, string>;

  /**
   * Monitor test file changes and trigger automatic test reruns.
   */
  readonly watch: boolean;

  /**
   * UUID for communications between Node and in-page scripts.
   */
  readonly uuid: string;

  private readonly testFinder: TestFinder;

  private readonly cwdRequestListener: http.RequestListener;

  private readonly staticRequestListener: http.RequestListener;

  private readonly buildContextPromise: Promise<esbuild.BuildContext>;

  readonly httpServer: HttpServer;

  constructor({
    cwd,
    setup,
    tests,
    entryPoints,
    watch,
    uuid,
  }: FileServerOptions) {
    super();
    this.cwd = cwd;
    this.setupFile = setup;
    this.testPatterns = tests;
    this.entryPoints = entryPoints;
    this.watch = watch;
    this.uuid = uuid;

    this.testFinder = new TestFinder({
      patterns: tests,
      cwd,
      watch,
    });

    this.cwdRequestListener = sirv(this.cwd, {
      dev: true,
    });
    this.staticRequestListener = sirv(staticDir, {
      dev: true,
      onNoMatch: this.cwdRequestListener,
    });

    this.buildContextPromise = this.initBuildContext();

    this.httpServer = http.createServer((request, response) => {
      this.handleRequest(request, response)
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error(e);
          response.writeHead(500);
          response.end();
        });
    }) as HttpServer;

    this.httpServer.unref();
  }

  /**
   * Pathname to built file hash & content map.
   * For instance, '/stdin.js' -> { text: 'console.log(1)' hash: 'xxx' }.
   */
  readonly fileContents = new Map<string, { text: string, hash: string }>();

  /**
   * Pathname to source map payload map.
   * For instance, '/stdin.js' -> { version: 3, ... }.
   */
  readonly sourceMapPayloads = new Map<string, SourceMapPayload>();

  private updateBuiltFiles(files: esbuild.OutputFile[]) {
    const { cwd, fileContents, sourceMapPayloads } = this;
    return files.reduce((changed, { path: absPath, hash, text }) => {
      const pathname = `/${path.relative(cwd, absPath).replace(/\\/g, '/')}`;

      // Skip unchanged files.
      const same = fileContents.get(pathname)?.hash === hash;
      if (same) return changed;

      fileContents.set(pathname, { text, hash });

      // Cache source maps for stack trace and coverage.
      // Note that Node.js requires the sources field to be absolute file URLs.
      if (pathname.endsWith('.map')) {
        const payload = JSON.parse(text) as SourceMapPayload;
        const baseURL = pathToFileURL(absPath);
        payload.sources = payload.sources.map((source) => new URL(source, baseURL).href);
        sourceMapPayloads.set(pathname.slice(0, -4), payload);
      }

      return true;
    }, false);
  }

  private building = false;

  private readonly importFilesLoader: esbuild.Plugin = {
    name: 'import files loader',
    setup: (build) => {
      // Resolve the setup file import path.
      let setupFileImportPath = this.setupFile;
      if (this.setupFile) {
        setupFileImportPath = path.resolve(this.cwd, this.setupFile).replace(/\\/g, '/');
      }

      build.onResolve({ filter: /^<stdin>$/ }, () => ({ path: 'stdin', namespace: 'wrightplay' }));
      build.onLoad({ filter: /^/, namespace: 'wrightplay' }, async () => {
        // Sort to make the output stable
        const importPaths = await this.testFinder.getFiles();
        importPaths.sort();

        // Prepend the setup file if any
        if (setupFileImportPath) importPaths.unshift(setupFileImportPath);

        if (importPaths.length === 0) {
          if (this.watch) {
            // eslint-disable-next-line no-console
            console.error('No test file found');
          } else {
            throw new Error('No test file found');
          }
        }

        const importStatements = importPaths.map((file) => `import '${file}'`).join('\n');
        return {
          contents: `${importStatements}\n(${clientRunner.init.toString()})('${this.uuid}')`,
          resolveDir: this.cwd,
        };
      });
    },
  };

  private readonly builtFilesUpdater: esbuild.Plugin = {
    name: 'built files updater',
    setup: (build) => {
      let buildCount = 0;
      let lastBuildFailed = false;
      build.onStart(() => {
        this.building = true;
      });
      build.onEnd((result) => {
        this.building = false;
        buildCount += 1;
        const files = result.outputFiles!;
        const changed = this.updateBuiltFiles(files);
        this.emit('ready'); // signals the http server to respond

        if (!this.watch) return;

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
          this.testFinder.setRelevantFiles(watchFiles);
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

        this.testFinder.setRelevantFiles(watchFiles);

        // Emit the updated event so as to trigger a rerun.
        // Bypass the initial event to avoid unnecessary reruns.
        if (buildCount > 1) this.emit('changed');
      });
    },
  };

  private async initBuildContext() {
    const buildContext = await esbuild.context({
      entryPoints: {
        ...this.entryPoints,
        // The stdin API doesn't support onLoad callbacks,
        // so we use the entry point workaround.
        // https://github.com/evanw/esbuild/issues/720
        '__wrightplay__/stdin': '<stdin>',
      },
      metafile: this.watch,
      bundle: true,
      format: 'esm',
      sourcemap: 'linked',
      outdir: './',
      absWorkingDir: this.cwd,
      define: { WRIGHTPLAY_CLIENT_UUID: `'${this.uuid}'` },
      plugins: [
        this.importFilesLoader,
        this.builtFilesUpdater,
      ],
      write: false,
    });

    return buildContext;
  }

  async handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    const { pathname } = new URL(request.url!, `http://${request.headers.host}`);

    if (this.building) {
      await new Promise<void>((resolve) => {
        this.once('ready', resolve);
      });
    }

    const builtContent = this.fileContents.get(pathname);
    if (!builtContent) {
      this.staticRequestListener(request, response);
      return;
    }

    const mimeType = mimeLookup(pathname) || '';
    response.writeHead(200, {
      'Content-Type': `${mimeType}; charset=utf-8`,
    });
    response.end(builtContent.text);
  }

  private async launchHttpServer(): Promise<AddressInfo> {
    // Avoid browser blocked ports.
    const port = await getPort({ port: portNumbers(10081, 65535) });
    await new Promise<void>((resolve) => {
      this.httpServer.listen(port, '127.0.0.1', resolve);
    });

    return this.httpServer.address()!;
  }

  private fileChangeCallback: (() => void) | undefined;

  private async launchFileBuild() {
    const buildContext = await this.buildContextPromise;

    if (this.watch) {
      this.fileChangeCallback = () => {
        buildContext.rebuild()
          // Do nothing as esbuild prints the errors itself
          .catch(() => {});
      };

      this.testFinder.on('change', this.fileChangeCallback);
      this.testFinder.updateFiles();
    } else {
      this.testFinder.updateFiles();
      await buildContext.rebuild();
    }
  }

  private async launchInternal() {
    const [addressInfo] = await Promise.all([
      this.launchHttpServer(),
      this.launchFileBuild(),
    ]);
    return addressInfo;
  }

  private launchPromise: Promise<AddressInfo> | undefined;

  launch(): Promise<AddressInfo> {
    if (!this.launchPromise) {
      this.launchPromise = this.launchInternal()
        .finally(() => {
          this.launchPromise = undefined;
        });
    }
    return this.launchPromise;
  }

  async close() {
    if (this.fileChangeCallback) {
      this.testFinder.off('change', this.fileChangeCallback);
    }

    await new Promise((resolve) => {
      this.httpServer.close(resolve);
    });
  }

  async dispose() {
    await Promise.all([
      this.buildContextPromise.then((buildContext) => buildContext.dispose()),
      this.close(),
    ]);
    this.testFinder[Symbol.dispose]();
  }

  [Symbol.asyncDispose]() {
    return this.dispose();
  }
}
