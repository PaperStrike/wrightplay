import path from 'path';
import { pathToFileURL } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import type { Profiler } from 'inspector';
import type { SourceMapPayload } from 'module';

import type playwright from 'playwright';

/**
 * Playwright's `ScriptCoverage`, which has an extra `source` property.
 * @see [coverage.stopJSCoverage() | Playwright](https://playwright.dev/docs/api/class-coverage#coverage-stop-js-coverage)
 * @see [Profiler.ScriptCoverage | Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-ScriptCoverage)
 */
type PlaywrightScriptCoverage = Awaited<ReturnType<playwright.Coverage['stopJSCoverage']>>[number];

/**
 * Node.js source map cache.
 * @see [Source map cache | Node.js Documentation](https://nodejs.org/api/cli.html#source-map-cache)
 */
interface NodeSourceMapCache {
  [fileURL: string]: {
    url: string | null;
    data: SourceMapPayload;
    lineLengths: number[];
  }
}

/**
 * Node.js coverage output.
 * @see [Coverage output | Node.js Documentation](https://nodejs.org/api/cli.html#coverage-output)
 */
interface NodeCoverageOutput extends Profiler.GetBestEffortCoverageReturnType {
  'source-map-cache'?: NodeSourceMapCache;
}

export type CoverageReporterOptions = {
  /**
   * The absolute base directory for file paths in the entries and output coverage.
   * Defaults to process.cwd().
   */
  cwd?: string;

  /**
   * Pathname to file content map.
   * For instance, `/stdin.js` -> `console.log(1)`.
   * Used to read source map contents.
   */
  sourceMapPayloads?: ReadonlyMap<string, SourceMapPayload>;

  /**
   * PID of the coverage source.
   */
  pid?: number;
};

// export const defaultExcludeCoverage = (absPath: string) => {
//
// };

/**
 * Return an array of the length of each line.
 * @see [source-map-cache.js · nodejs/node](https://github.com/nodejs/node/blob/26846a05e2ac232742e6a0bfaa7baac5e86a015b/lib/internal/source_map/source_map_cache.js#L129-L139)
 */
const getLineLengths = (content: string) => (
  content.split(/[\n\u2028\u2029]/).map((line) => line.length)
);

/**
 * Return the filename the coverage should be written as.
 * @see [inspector_profiler.cc · nodejs/node](https://github.com/nodejs/node/blob/26846a05e2ac232742e6a0bfaa7baac5e86a015b/src/inspector_profiler.cc#L172-L179)
 */
const getCoverageFileName = (pid: number) => `/coverage-${pid}-${Date.now()}-0.json`;

/**
 * Convert Playwright coverage result to Node.js coverage output.
 * Then it will be readable via Node.js coverage tools like c8.
 */
export default class CoverageReporter {
  readonly nodeCoverageOutput: NodeCoverageOutput = { result: [] };

  readonly nodeCoverageFileName: string;

  constructor(
    coverageResult: PlaywrightScriptCoverage[],
    {
      cwd = process.cwd(),
      sourceMapPayloads = new Map(),
      pid = process.pid,
    }: CoverageReporterOptions = {},
  ) {
    const { nodeCoverageOutput } = this;
    coverageResult.forEach((scriptCoverage) => {
      const { url, source, ...rest } = scriptCoverage;
      const { pathname } = new URL(url);
      const fileURL = pathToFileURL(path.join(cwd, pathname)).href;

      // Convert to use file URLs.
      nodeCoverageOutput.result.push({
        ...rest,
        url: fileURL,
      });

      if (!source) return;
      const payload = sourceMapPayloads.get(pathname);
      if (!payload) return;

      // Generate source map cache field.
      (nodeCoverageOutput['source-map-cache'] ??= {})[fileURL] = {
        lineLengths: getLineLengths(source),
        data: payload,
        url: null,
      };
    });
    this.nodeCoverageFileName = getCoverageFileName(pid);
  }

  async save(reportDir: string) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      path.join(reportDir, this.nodeCoverageFileName),
      JSON.stringify(this.nodeCoverageOutput),
    );
  }
}
