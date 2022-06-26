import nodeMocha from 'mocha';
import { expect } from 'expect';

const {
  describe,
  it,
  beforeEach,
  before,
  afterEach,
  after,
} = await (async () => {
  if (typeof window === 'undefined') return nodeMocha;

  const { onInit, done } = await import('../src/index.js');

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

  return window;
})();

const customIt = Object.assign(it, {
  beforeEach,
  afterEach,
  beforeAll: before,
  afterAll: after,
});

export {
  describe,
  customIt as it,
  expect,
};
