import { RunnerOptions } from './Runner.js';

export * from './BrowserLog.js';
export { default as BrowserLogger } from './BrowserLog.js';

export * from './CoverageReporter.js';
export { default as CoverageReporter } from './CoverageReporter.js';

export * from './Runner.js';
export { default as Runner } from './Runner.js';

export type ConfigRunOptions = Partial<RunnerOptions>;
export type ConfigOptions = ConfigRunOptions | ConfigRunOptions[];
