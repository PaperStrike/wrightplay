/**
 * APIs that are common to Node.js and the DOM.
 *
 * Better if a lib provides these types.
 *
 * https://github.com/microsoft/TypeScript-DOM-lib-generator/issues/1402
 */

declare global {
  interface URL {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toString(): string;
    toJSON(): string;
  }

  interface URLConstructor {
    new(input: string, base?: string | URL): URL;
    createObjectURL(object: Blob): string;
    revokeObjectURL(url: string): void;
    readonly prototype: URL;
  }

  const URL: URLConstructor;
}

export {};
