import { describe, it, expect } from '../default.setup.js';
import HostHandle from '../../src/client/ws/handle/HostHandle.js';
import { pageHandle } from '../../src/client/api.js';

describe('handle', () => {
  it('should evaluate', async () => {
    let evaluated = false;
    window.addEventListener('evaluate', () => {
      evaluated = true;
    }, { once: true });
    await pageHandle.evaluate(async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('evaluate'));
      });
    });
    expect(evaluated).toBe(true);
  });

  it('should evaluate expression', async () => {
    await expect(pageHandle.evaluate('1 + 2')).resolves.toBe(3);
  });

  it('should evaluate shorthand', async () => {
    const obj = {
      shorthand() {
        return 1 + 2;
      },
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    await expect(pageHandle.evaluate(obj.shorthand)).resolves.toBe(3);
  });

  it('should evaluate async shorthand', async () => {
    const obj = {
      async asyncShorthand() {
        return 1 + 2;
      },
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    await expect(pageHandle.evaluate(obj.asyncShorthand)).resolves.toBe(3);
  });

  it('should evaluate with arg', async () => {
    let evaluated = false;
    window.addEventListener('evaluate-with-arg', () => {
      evaluated = true;
    }, { once: true });
    await pageHandle.evaluate(async (page, eventName) => {
      await page.evaluate((n) => {
        window.dispatchEvent(new Event(n));
      }, eventName);
    }, 'evaluate-with-arg');
    expect(evaluated).toBe(true);
  });

  it('should evaluate with handle arg', async () => {
    let evaluated = false;
    window.addEventListener('evaluate-with-handle-arg', () => {
      evaluated = true;
    }, { once: true });
    await pageHandle.evaluate(async (_, [eventName, page]) => {
      await page.evaluate((n) => {
        window.dispatchEvent(new Event(n));
      }, eventName);
    }, ['evaluate-with-handle-arg', pageHandle] as const);
    expect(evaluated)
      .toBe(true);
  });

  it('should evaluate and return results', async () => {
    let evaluated = false;
    window.addEventListener('evaluate-return-results', () => {
      evaluated = true;
    }, { once: true });
    const results = await pageHandle.evaluate(async (page, eventName) => {
      await page.evaluate((n) => {
        window.dispatchEvent(new Event(n));
      }, eventName);
      return [1, 2, 4];
    }, 'evaluate-return-results');
    expect(evaluated).toBe(true);
    expect(results).toEqual([1, 2, 4]);
  });

  it('should evaluate and return handle', async () => {
    let evaluated = false;
    window.addEventListener('evaluate-handle', () => {
      evaluated = true;
    }, { once: true });
    const contextHandle = await pageHandle.evaluateHandle(async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('evaluate-handle'));
      });
      return page.context();
    });
    expect(evaluated).toBe(true);
    expect(contextHandle).toBeInstanceOf(HostHandle);
    const browserVersion = await contextHandle.evaluate((context) => (
      context.browser()?.version()
    ));
    expect(typeof browserVersion).toBe('string');
  });

  it('should throw on unserializable arg', async () => {
    await expect(pageHandle.evaluate(() => {}, () => {}))
      .rejects.toThrow('Unexpected value');
  });

  it('should use null for unserializable results', async () => {
    await expect(pageHandle.evaluate(() => [() => {}, 16]))
      .resolves.toEqual([null, 16]);
  });

  it('should return serialized value', async () => {
    const objHandle = await pageHandle.evaluateHandle(() => [73, 26]);
    await expect(objHandle.jsonValue()).resolves.toEqual([73, 26]);
  });

  it('should get properties', async () => {
    const objHandle = await pageHandle.evaluateHandle(() => ({ p: [1, 2] }));
    const props = [...await objHandle.getProperties()];
    expect(props).toHaveLength(1);
    const [key, value] = props[0];
    expect(key).toBe('p');
    expect(value).toBeInstanceOf(HostHandle);
    await expect(value.jsonValue()).resolves.toEqual([1, 2]);
  });

  it('should get property', async () => {
    const objHandle = await pageHandle.evaluateHandle(() => ({ p: [1, 2] }));
    const [propHandle, notExistPropHandle] = await Promise.all([
      objHandle.getProperty('p'),
      objHandle.getProperty('not-exist'),
    ]);
    expect(propHandle).toBeInstanceOf(HostHandle);
    expect(notExistPropHandle).toBeInstanceOf(HostHandle);
    await Promise.all([
      expect(propHandle.jsonValue()).resolves.toEqual([1, 2]),
      expect(notExistPropHandle.jsonValue()).resolves.toBe(undefined),
    ]);
  });

  it('should dispose', async () => {
    const objHandle = await pageHandle.evaluateHandle(() => ({ p: [1, 2] }));
    await objHandle.dispose();
    await Promise.all([
      expect(objHandle.jsonValue()).rejects.toThrow('disposed'),
      expect(objHandle.getProperties()).rejects.toThrow('disposed'),
      expect(objHandle.getProperty('p')).rejects.toThrow('disposed'),
    ]);
  });
});
