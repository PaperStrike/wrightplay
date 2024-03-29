import { createRequire } from 'node:module';
import { Command, Option } from '@commander-js/extra-typings';

import {
  Runner,
  type BrowserServerOptions,
  type RunnerOptions,
  type ConfigOptions,
} from '../server/api.js';

import configSearcher from './configSearcher.js';

const require = createRequire(import.meta.url);
const pkgJSON = require('../../package.json') as {
  name: string;
  version: string;
};

// Simple JSON.parse. Error by Playwright if any.
export const parseBrowserServerOptions = (str: string) => JSON.parse(str) as BrowserServerOptions;

const command = new Command()
  .version(pkgJSON.version)
  .name(pkgJSON.name)
  .argument('[test-or-entry...]', 'Test files and entry points. Use glob for tests, name=path for entries')
  .addOption(new Option('--cwd <dir>', 'Current working directory. Defaults to `process.cwd()`'))
  .addOption(new Option('--config <file>', 'Path to config file. Defaults to auto, see docs full config file search places'))
  .addOption(new Option('-s, --setup <file>', 'File to run before the test files'))
  .addOption(new Option('-w, --watch', 'Watch for setup and test files changes and automatically rerun the tests. Defaults to `false`'))
  .addOption(new Option('-b, --browser <browser>', 'Type of the browser. One of: "chromium", "firefox", "webkit". Defaults to "chromium"')
    .choices(['chromium', 'firefox', 'webkit'] as const))
  .addOption(new Option('--browser-server-options <json>', 'Options used to launch the test browser server. Defaults to the Playwright defaults')
    .argParser(parseBrowserServerOptions))
  .addOption(new Option('-d, --debug', 'Run browser in headed mode. Defaults to `false`'))
  .addOption(new Option('--no-cov', 'Disable coverage file output. This only matters when `NODE_V8_COVERAGE` is set. Defaults to `false` on chromium, `true` on firefox and webkit'));

export type CLIOptions = ReturnType<typeof command.opts>;

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

export const program = command
  .action(async (testAndEntries, options) => {
    const runnerOptionsList = await parseRunnerOptionsFromCLI(testAndEntries, options);
    await runnerOptionsList.reduce(async (last, runnerOptions) => {
      await last;
      const runner = new Runner(runnerOptions);
      const exitCode = await runner.runTests();
      process.exitCode ||= exitCode;
    }, Promise.resolve());
  });
