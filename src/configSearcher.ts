import { pathToFileURL } from 'node:url';
import { lilconfig } from 'lilconfig';

const moduleName = 'wrightplay';

const load = async (specifier: string) => (
  (await import(pathToFileURL(specifier).href) as { default: unknown }).default
);

const searcher = lilconfig(moduleName, {
  searchPlaces: [
    'package.json',
    `.${moduleName}rc`,
    `.${moduleName}rc.json`,
    `.${moduleName}rc.ts`,
    `.${moduleName}rc.mts`,
    `.${moduleName}rc.cts`,
    `.${moduleName}rc.js`,
    `.${moduleName}rc.mjs`,
    `.${moduleName}rc.cjs`,
    `${moduleName}.config.ts`,
    `${moduleName}.config.mts`,
    `${moduleName}.config.cts`,
    `${moduleName}.config.js`,
    `${moduleName}.config.mjs`,
    `${moduleName}.config.cjs`,
  ],
  loaders: {
    '.js': load,
    '.mjs': load,
    '.cjs': load,
    '.ts': load,
    '.mts': load,
    '.cts': load,
  },
});

export default searcher;
