/**
 * Simple polyfill that covers the `using` and `async using` use cases.
 */

// @ts-expect-error polyfill
Symbol.dispose ??= Symbol('Symbol.dispose');
// @ts-expect-error polyfill
Symbol.asyncDispose ??= Symbol('Symbol.asyncDispose');
