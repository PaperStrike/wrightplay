import 'mocha';
import { onInit, done } from 'wrightplay';

mocha.setup({
  color: true,
  fullTrace: true,
  reporter: 'spec',
  ui: 'bdd',
});

onInit(() => {
  mocha.run((failures) => {
    done(failures > 0 ? 1 : 0);
  });
});
