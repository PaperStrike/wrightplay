import { lilconfig } from 'lilconfig';
import jiti from 'jiti';

const moduleName = 'wrightplay';

const tsLoader = jiti('', {
  interopDefault: true,
});

const configLoader = (filepath: string) => {
  try {
    return tsLoader(filepath) as unknown;
  } catch (error) {
    throw new Error(`Failed to load TS config ${filepath}`, {
      cause: error,
    });
  }
};

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
    `.config/${moduleName}rc`,
    `.config/${moduleName}rc.json`,
    `.config/${moduleName}rc.ts`,
    `.config/${moduleName}rc.mts`,
    `.config/${moduleName}rc.cts`,
    `.config/${moduleName}rc.js`,
    `.config/${moduleName}rc.mjs`,
    `.config/${moduleName}rc.cjs`,
    `${moduleName}.config.ts`,
    `${moduleName}.config.mts`,
    `${moduleName}.config.cts`,
    `${moduleName}.config.js`,
    `${moduleName}.config.mjs`,
    `${moduleName}.config.cjs`,
  ],
  loaders: {
    '.js': configLoader,
    '.mjs': configLoader,
    '.cjs': configLoader,
    '.ts': configLoader,
    '.mts': configLoader,
    '.cts': configLoader,
  },
});

export default searcher;
