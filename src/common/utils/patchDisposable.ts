/**
 * Simple explicit resource management API polyfill.
 *
 * https://github.com/tc39/proposal-explicit-resource-management
 */

/* eslint-disable max-classes-per-file */
/* c8 ignore start */

if (!Symbol.dispose) {
  Object.defineProperty(Symbol, 'dispose', {
    value: Symbol('Symbol.dispose'),
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

if (!Symbol.asyncDispose) {
  Object.defineProperty(Symbol, 'asyncDispose', {
    value: Symbol('Symbol.asyncDispose'),
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

globalThis.SuppressedError ??= (() => {
  const nonEnumerableDescriptor = { writable: true, enumerable: false, configurable: true };
  const SEConstructor = function SuppressedError(
    this: SuppressedError,
    error: unknown,
    suppressed: unknown,
    message?: string,
  ) {
    if (new.target === undefined) {
      return new SEConstructor(error, suppressed, message);
    }
    if (message !== undefined) {
      Object.defineProperty(this, 'message', { value: String(message), ...nonEnumerableDescriptor });
    }
    Object.defineProperties(this, {
      error: { value: error, ...nonEnumerableDescriptor },
      suppressed: { value: suppressed, ...nonEnumerableDescriptor },
    });
  } as SuppressedErrorConstructor;

  Object.setPrototypeOf(SEConstructor.prototype, Error.prototype);
  Object.defineProperties(SEConstructor.prototype, {
    message: { value: '', ...nonEnumerableDescriptor },
    name: { value: 'SuppressedError', ...nonEnumerableDescriptor },
  });

  return SEConstructor;
})();

globalThis.DisposableStack ??= class DisposableStack {
  #disposed = false;

  get disposed() {
    return this.#disposed;
  }

  #stack: {
    v: Disposable | undefined,
    m: ((this: Disposable | undefined) => unknown),
  }[] = [];

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;

    const stack = this.#stack;
    this.#stack = [];

    let hasError = false;
    let error: unknown;

    while (stack.length > 0) {
      const { m, v } = stack.pop()!;
      try {
        m.call(v);
      } catch (e) {
        error = hasError ? new SuppressedError(e, error, 'An error was suppressed during disposal.') : e;
        hasError = true;
      }
    }

    if (hasError) {
      throw error;
    }
  }

  use<T extends Disposable | null | undefined>(value: T): T {
    if (this.#disposed) {
      throw new ReferenceError('This stack has already been disposed');
    }

    if (value !== null && value !== undefined) {
      const method = Symbol.dispose in value
        ? value[Symbol.dispose]
        : undefined;
      if (typeof method !== 'function') {
        throw new TypeError('The value is not disposable');
      }
      this.#stack.push({ v: value, m: method });
    }

    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    if (this.#disposed) {
      throw new ReferenceError('This stack has already been disposed');
    }

    if (typeof onDispose !== 'function') {
      throw new TypeError('The callback is not a function');
    }

    this.#stack.push({ v: undefined, m: () => onDispose.call(undefined, value) });

    return value;
  }

  defer(onDispose: () => void): void {
    if (this.#disposed) {
      throw new ReferenceError('This stack has already been disposed');
    }

    if (typeof onDispose !== 'function') {
      throw new TypeError('The callback is not a function');
    }

    this.#stack.push({ v: undefined, m: onDispose });
  }

  move(): DisposableStack {
    if (this.#disposed) {
      throw new ReferenceError('This stack has already been disposed');
    }

    const stack = new DisposableStack();
    stack.#stack = this.#stack;

    this.#disposed = true;
    this.#stack = [];

    return stack;
  }

  [Symbol.dispose]() {
    return this.dispose();
  }

  declare readonly [Symbol.toStringTag]: string;

  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: 'DisposableStack',
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
};

globalThis.AsyncDisposableStack ??= class AsyncDisposableStack {
  #disposed = false;

  get disposed() {
    return this.#disposed;
  }

  #stack: {
    v: AsyncDisposable | Disposable | undefined,
    m: ((this: AsyncDisposable | Disposable | undefined) => unknown) | undefined,
  }[] = [];

  async disposeAsync() {
    if (this.#disposed) return;
    this.#disposed = true;

    const stack = this.#stack;
    this.#stack = [];

    let hasError = false;
    let error: unknown;

    while (stack.length > 0) {
      const { m, v } = stack.pop()!;
      try {
        // eslint-disable-next-line no-await-in-loop
        await (m?.call(v));
      } catch (e) {
        error = hasError ? new SuppressedError(e, error, 'An error was suppressed during disposal.') : e;
        hasError = true;
      }
    }

    if (hasError) {
      throw error;
    }
  }

  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T {
    if (this.#disposed) {
      throw new ReferenceError('This async stack has already been disposed');
    }

    if (value === null || value === undefined) {
      this.#stack.push({ v: undefined, m: undefined });
    } else {
      let method = Symbol.asyncDispose in value
        ? value[Symbol.asyncDispose] as () => unknown
        : undefined;
      if (method === undefined) {
        const syncDispose = Symbol.dispose in value ? value[Symbol.dispose] : undefined;
        if (typeof syncDispose === 'function') {
          method = function omitReturnValue(this: unknown) { syncDispose.call(this); };
        }
      }
      if (typeof method !== 'function') {
        throw new TypeError('The value is not disposable');
      }
      this.#stack.push({ v: value, m: method });
    }

    return value;
  }

  adopt<T>(value: T, onDisposeAsync: (value: T) => PromiseLike<void> | void): T {
    if (this.#disposed) {
      throw new ReferenceError('This async stack has already been disposed');
    }

    if (typeof onDisposeAsync !== 'function') {
      throw new TypeError('The callback is not a function');
    }

    this.#stack.push({ v: undefined, m: () => onDisposeAsync.call(undefined, value) });

    return value;
  }

  defer(onDisposeAsync: () => PromiseLike<void> | void): void {
    if (this.#disposed) {
      throw new ReferenceError('This async stack has already been disposed');
    }

    if (typeof onDisposeAsync !== 'function') {
      throw new TypeError('The callback is not a function');
    }

    this.#stack.push({ v: undefined, m: onDisposeAsync });
  }

  move(): AsyncDisposableStack {
    if (this.#disposed) {
      throw new ReferenceError('This async stack has already been disposed');
    }

    const stack = new AsyncDisposableStack();
    stack.#stack = this.#stack;

    this.#disposed = true;
    this.#stack = [];

    return stack;
  }

  [Symbol.asyncDispose]() {
    return this.disposeAsync();
  }

  declare readonly [Symbol.toStringTag]: string;

  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: 'AsyncDisposableStack',
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
};
