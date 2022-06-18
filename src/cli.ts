#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import Runner, { BrowserTypeName, RunnerOptions } from './Runner.js';
import { ConfigOptions } from './node.js';
import configSearcher from './configSearcher.js';

const require = createRequire(import.meta.url);
const pkgJSON = require('../package.json') as {
  name: string;
  version: string;
};

export const program = new Command();

program
  .version(pkgJSON.version)
  .name(pkgJSON.name);

program
  .argument('[test-or-entry...]', 'Test files and entry points. Use glob for tests, name=path for entries')
  .option('--cwd <dir>', 'Current working directory. Defaults to `process.cwd()`')
  .option('--config <file>', 'Path to config file. Defaults to auto, see docs full config file search places')
  .option('-s, --setup <file>', 'File to run before the test files')
  .option('--build-max-age <seconds>', 'Number of seconds the test build remains fresh after the test is built. Defaults to 2', Number)
  .option('-b, --browser <browser>', 'Type of the browser. One of: "chromium", "firefox", "webkit". Defaults to "chromium"')
  .option('-d, --debug', 'Run browser in headed mode. Defaults to `false`')
  .option('--no-cov', 'Disable coverage file output. This only matters when `NODE_V8_COVERAGE` is set. Defaults to `false` on chromium, `true` on firefox and webkit');

export interface CLIOptions {
  cwd?: string;
  config?: string;
  setup?: string;
  buildMaxAge?: number;
  browser?: BrowserTypeName; // not enforced. error by Playwright if any.
  debug?: boolean;
  cov: boolean; // required member according to `commander`
}

export const parseRunnerOptionsFromCLI = async (
  testAndEntries: string[],
  options: CLIOptions,
): Promise<RunnerOptions[]> => {
  const tests: string[] = [];
  const entryPoints: Record<string, string> = {};
  testAndEntries.forEach((testOrEntry) => {
    const [entryKey, entryValue] = testOrEntry.split('=', 2);
    if (entryKey && entryValue) {
      entryPoints[entryKey] = entryValue;
    } else {
      tests.push(testOrEntry);
    }
  });

  const {
    config,
    debug,
    cov,
    ...sharedOptions
  } = options;
  const baseSearchResult = await (config
    ? configSearcher.load(config)
    : configSearcher.search(sharedOptions.cwd));
  const baseList = baseSearchResult?.config as ConfigOptions | undefined;

  return (Array.isArray(baseList) ? baseList : [baseList]).map((base) => {
    const mergedOptions: RunnerOptions = {
      ...base,
      ...sharedOptions,
      tests: ([] as string[]).concat(base?.tests ?? [], tests),
      entryPoints: { ...base?.entryPoints, ...entryPoints },
    };
    if (!cov) mergedOptions.noCov = true;
    if (debug) {
      mergedOptions.headless = false;
      (mergedOptions.browserServerOptions ??= {}).devtools = true;
    }
    return mergedOptions;
  });
};

program
  .action(async (testAndEntries: string[], options: CLIOptions) => {
    const runnerOptionsList = await parseRunnerOptionsFromCLI(testAndEntries, options);
    await runnerOptionsList.reduce(async (last, runnerOptions) => {
      await last;
      const exitCode = await new Runner(runnerOptions).runTests();
      process.exitCode ||= exitCode;
    }, Promise.resolve());
  })
  .parse();
