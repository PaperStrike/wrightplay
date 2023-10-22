# wrightplay

[![Build Status](https://github.com/PaperStrike/wrightplay/actions/workflows/test.yml/badge.svg)](https://github.com/PaperStrike/wrightplay/actions/workflows/test.yml)
[![npm Package](https://img.shields.io/npm/v/wrightplay?logo=npm "wrightplay")](https://www.npmjs.com/package/wrightplay)

Playwright needs you focus on Node.js side (e2e test), wrightplay draws you back to the browsers (unit test).

**Project Under Development**

But feel free to try! All APIs should work, they just lack test cases and documentations.

## When should I choose wrightplay?

* You want Node.js native coverage reports
* You want full TypeScript supports
* You want NET interceptor that intercepts all page requests, with in-page control
* You want source mapped error stack traces
* You don't want the error stack mapping to happen inside the browser
* You don't want the interceptor to occupy Service Worker
* You don't want to find, choose, and install a “loader” dependency for each browser

The key features come from:

* It converts chromium coverage output to Node.js format
* The source mapping of error traces happens outside the browser, affecting no page script but only the Node.js console output
* Everything written in TypeScript
* Browsers from [Playwright](https://playwright.dev)
* Proxies [`page.route`](https://playwright.dev/docs/api/class-page#page-route) through WebSocket to a specific module within the page to intercept page requests with in-page control and without occupying Service Worker <!-- Moreover, you may have heard that `page.route` has supported (“likely” as of now) Service Worker interception on Chromium since Playwright 1.24 -->

## Installation

```shell
npm i -D wrightplay
```

Install test browsers with Playwright's cli.

```shell
# Default browsers (chromium, firefox, and webkit)
npx playwright install

# Specific browser(s)
# browser: one of: chromium, chrome, chrome-beta, msedge, msedge-beta, msedge-dev, firefox, webkit
# E.g., npx playwright install chromium
npx playwright install <browser...>
```

To use browsers available on the machine, use [`channel`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server-option-channel) via [`browserServerOptions`](#browserserveroptions).

For CI environments, check out
* [Install system dependencies · Command line tools | Playwright](https://playwright.dev/docs/cli#install-system-dependencies).

For more available options and descriptions, check out
* [Installing browsers · Browsers | Playwright](https://playwright.dev/docs/browsers#installing-browsers)
* [Install browsers · Command line tools | Playwright](https://playwright.dev/docs/cli#install-browsers)

## Basic

### Write a test setup

#### Listen to test ready

```ts
import { onInit } from 'wrightplay';

onInit(() => {
  startTesting();
});
```

Pass a callback to `onInit` to act when all the test files got successfully imported. If called multiple times, `onInit` will call the callbacks in order. If a callback returns a promise, it will wait until the promise get fulfilled before calling the next callback. If a callback throws an error, the process will exit unsuccessfully.

#### Indicate the result of your tests

```ts
import { done } from 'wrightplay';

onTestEnd((failures) => {
  // Pass the desired process exit number to `done`.
  done(failures > 0 ? 1 : 0);
});
```

The process may never exit if you don't call this function.

Some test runners like Mocha require additional steps to run in browsers, see [Working with...](#working-with) part for examples.

### Start

If the tests inject the setup on their own,

```shell
wrightplay test/**/*.spec.ts
```

If the setup is separate and the tests don't inject it themselves,

```shell
wrightplay -s test/setup.ts test/**/*.spec.ts
```

If you want Node.js API,

```ts
import { Runner } from 'wrightplay/node';

const runner = new Runner({
  setup: 'test/setup.ts',
  tests: 'test/**/*.spec.ts',
});

process.exit(await runner.runTests());
```

Check [Options](#options) for full option list.

## HostHandle

APIs similar to [`JSHandle` in Playwright](https://playwright.dev/docs/api/class-jshandle).

Just like you can pass a function from node to browser to run via `page.evaluate` in Playwright, you can pass a function from browser to node via `pageHandle.evaluate` in wrightplay.

`pageHandle` and `contextHandle` represent the [`Page`](https://playwright.dev/docs/api/class-page) and [`BrowserContext`](https://playwright.dev/docs/api/class-browsercontext) Playwright instance that controls the current page respectively.

### Evaluate

Similar to [`JSHandle.evaluate` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-evaluate).

```ts
import { pageHandle } from 'wrightplay';

const screenshotPath = 'screenshots/1.png';
await pageHandle.evaluate(async (page, path) => {
  await page.screenshot({ path });
}, screenshotPath);
```

### EvaluateHandle

Similar to [`JSHandle.evaluateHandle` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-evaluate-handle).

```ts
import { pageHandle } from 'wrightplay';

const browserHandle = await pageHandle
  .evaluateHandle((page) => page.context().browser());

// "103.0.5060.42" on chromium as of writing
await browserHandle.evaluate((b) => b.version());
```

### Dispose

Similar to [`JSHandle.dispose` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-dispose).

### getProperties

Similar to [`JSHandle.getProperties` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-get-properties).

### getProperty

Similar to [`JSHandle.getProperty` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-get-property).

### jsonValue

Similar to [`JSHandle.jsonValue` in Playwright](https://playwright.dev/docs/api/class-jshandle#js-handle-json-value).

## Route

Dedicated API faster than wrapping `contextRoute.evaluate` for routing, uses `ArrayBuffer` and `Blob` for binary data. The handler callback stays in the browser and has access to all the scopes like a normal function has. 

Similar to [`browserContext.route` in Playwright](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).

```ts
import { contextRoute } from 'wrightplay';

const body = new Blob(['routed!']);
await contextRoute('hello', (r) => {
  r.fulfill({ body });
}, { times: 1 });

// "routed!"
await (await fetch('hello')).text();
```

All the routes by this API will auto “unroute” on page unload.

### Unroute

Similar to [`browserContext.unroute` in Playwright](https://playwright.dev/docs/api/class-browsercontext#browser-context-unroute).

## Coverage

Use [`NODE_V8_COVERAGE`](https://nodejs.org/api/cli.html#node_v8_coveragedir) environment variable to get coverage results. Tools like [`c8`](https://www.npmjs.com/package/c8) that use `NODE_V8_COVERAGE` internally work as well.

Note that firefox and webkit don't support coverage recording.

```shell
# Generate Node.js format coverage output to ./coverage/tmp/
cross-env NODE_V8_COVERAGE=coverage/tmp wrightplay test/*.spec.*

# Or use c8 coverage reports
c8 -a wrightplay test/*.spec.*
```

`-a`, `--exclude-after-remap` option enables `c8` to properly parse 1:many source maps for wrightplay. `c8` should enable this option by default, but they haven't yet.

## Configuration file

You can put the test options (see [Options](#options)) in a config file, and wrightplay will read it as the option base. See [`config`](#config) option for how the CLI resolves the config file path.

You can use an array of option objects to represent multiple test runs that should run in order. <!-- Parallel run may be available if one day I come out with a way to organize the output messages. Probably in another package like `@playwright/test` from `playwright-core`. -->

### JS

```js
export default {
  tests: 'test/**/*.spec.*',
};
```

### JSON

```json
{
  "tests": "test/**/*.spec.*"
}
```

### TS

```ts
import { ConfigOptions } from 'wrightplay/node';

const config: ConfigOptions = {
  tests: 'test/**/*.spec.*',
};

export default config;
```

## Options

### config

```shell
wrightplay --config path/to/config/file

# Omit to use default
wrightplay
```

CLI-only option.

Path to config file. The CLI checks these files by default:

```ts
[
  'package.json', // "wrightplay" property
  '.wrightplayrc',
  '.wrightplayrc.json',
  '.wrightplayrc.ts',
  '.wrightplayrc.mts',
  '.wrightplayrc.cts',
  '.wrightplayrc.js',
  '.wrightplayrc.mjs',
  '.wrightplayrc.cjs',
  '.config/wrightplayrc',
  '.config/wrightplayrc.json',
  '.config/wrightplayrc.ts',
  '.config/wrightplayrc.mts',
  '.config/wrightplayrc.cts',
  '.config/wrightplayrc.js',
  '.config/wrightplayrc.mjs',
  '.config/wrightplayrc.cjs',
  'wrightplay.config.ts',
  'wrightplay.config.mts',
  'wrightplay.config.cts',
  'wrightplay.config.js',
  'wrightplay.config.mjs',
  'wrightplay.config.cjs',
]
```

### setup

```shell
wrightplay -s <path/to/setup>
wrightplay --setup <path/to/setup>
```

File to run before the test files.

### tests

```shell
wrightplay [pattern...]
```

Patterns for the target test files. Check out [`globby`](https://www.npmjs.com/package/globby) for supported patterns.

### entryPoints

```shell
wrightplay [entry...]
```

Additional entry points to build. You can use this option to build workers.

In CLI, use format `name=path/to/entry`. For example,

```shell
wrightplay worker=test/web-worker-helper.ts
```

or config file

```json
{
  "entryPoints": {
    "worker": "test/web-worker.ts"
  }
}
```

will make this available:

```ts
const worker = new Worker('/worker.js');
// ...
```

### watch

```shell
wrightplay -w
wrightplay --watch
```

Watch the setup and test files for changes and automatically rerun the tests. Defaults to `false`.

### browser

```shell
wrightplay -b <browser>
wrightplay --browser <browser>
```

Browser type. One of: `chromium`, `firefox`, `webkit`. Defaults to `chromium`.

### browserServerOptions

```shell
wrightplay --browser-server-options <json>
```

Options used to launch the browser server. See [`browserType.launchServer([options])` in Playwright](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server) for details.

### headless

In CLI, use [`--debug`](#debug).

Run the browser in headless mode. Defaults to `true` unless the
`devtools` option (in [`browserServerOptions`](#browserserveroptions)) is `true`.

### debug

```shell
wrightplay -d
wrightplay --debug
```

CLI-only option.

This sets `devtools` (in [`browserServerOptions`](#browserserveroptions)) to `true` and [`headless`](#headless) to `false`.

### noCov

```shell
wrightplay --no-cov
```

Disable coverage file output. This only matters when `NODE_V8_COVERAGE` is set. Defaults to `false` on chromium, `true` on firefox and webkit.

### cwd

Current working directory. Defaults to `process.cwd()`.

## Working with...

### Mocha

Reference:
* [RUNNING MOCHA IN THE BROWSER | Mocha](https://mochajs.org/#running-mocha-in-the-browser)
* [mocha.run | Mocha - Documentation](https://mochajs.org/api/mocha#run)

#### Use mocha.js

In your `package.json`, add:

```json
{
  "browser": {
    "mocha": "mocha/mocha.js"
  }
}
```

#### Write mocha setup like

```ts
import 'mocha';
import { onInit, done } from 'wrightplay';

mocha.setup({
  ui: 'bdd',
  reporter: 'spec',
  color: true,
});

onInit(() => {
  mocha.run((failures) => {
    done(failures > 0 ? 1 : 0);
  });
});
```

### uvu

`uvu` has no reliable or future-proof way to run and get the test results programmatically. Track [lukeed/uvu · Issue #113](https://github.com/lukeed/uvu/issues/113).

Click [here](test/third-party/uvu/setup.ts) for an example setup that reads the test results by proxying the console messages.

### tape

`tape` needs some node-specific modules to work: `path`, `stream`, `events`, and `process`. So we need polyfills to get it to work in browsers.

Steps below may differ if you choose different providers.

#### Install polyfills

```shell
npm i -D path stream events process
```

In `package.json`, add:

```json
{
  "browser": {
    "process": "process/browser.js"
  }
}
```

#### Write tape setup like

```ts
import process from 'process';
import { done } from 'wrightplay';

globalThis.process = process;

const { onFailure, onFinish } = await import('tape');

let exitCode = 0;
onFailure(() => {
  exitCode = 1;
});
onFinish(() => {
  done(exitCode);
});
```

### Zora

#### Process zora messages

To setup zora, pipe zora reporters to read test results:

```ts
import { hold, report, createTAPReporter } from 'zora';
import { done, onInit } from 'wrightplay';

// Hold zora default run
hold();

// Record failed assertion
const tapReporter = createTAPReporter();
async function* record(stream: Parameters<typeof tapReporter>[0]) {
  let exitCode = 0;
  for await (const msg of stream) {
    if (msg.type === 'ASSERTION' && !msg.data.pass) {
      exitCode = 1;
    } else if (msg.type === 'ERROR') {
      done(1);
    } if (msg.type === 'TEST_END') {
      done(exitCode);
    }
    yield msg;
  }
}

onInit(async () => {
  // Run zora with piped reporter
  await report({
    reporter: (stream) => tapReporter(record(stream)),
  });
});
```

---
