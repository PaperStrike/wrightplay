import { it, expect } from '../default.setup.js';

describe('web worker', () => {
  it('should work', async () => {
    const worker = new Worker('/ww.js');
    const result = new Promise((resolve) => {
      worker.addEventListener('message', ({ data }) => resolve(data));
    });
    worker.postMessage([1, 2, 3]);
    await expect(result).resolves.toBe(6);
  });
});
