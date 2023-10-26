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
