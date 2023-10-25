import 'mocha';
import { onInit, done } from '../../../src/client/api.js';

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
