import type {Metadata, WidgetHost, HTTPOptions, HTTPResponse} from './model.js';
export * from './model.js';
declare global {
  var Widget: WidgetHost;
  var WidgetMetadata: Metadata;
  function fetch(url: string, options?: HTTPOptions): Promise<HTTPResponse>;
  var console: {log(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void; debug(...values: unknown[]): void};
  function atob(value: string): string;
  function btoa(value: string): string;
  /** Common URL subset: TV's shim does not support mutating URL properties. */
  class URL {
    constructor(input: string, base?: string);
    readonly href: string;
    readonly origin: string;
    readonly protocol: string;
    readonly hostname: string;
    readonly host: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
    readonly searchParams: URLSearchParams;
    toString(): string;
    toJSON(): string;
  }
  class URLSearchParams implements Iterable<[string, string]> {
    constructor(input?: string | Record<string, string> | Iterable<[string, string]>);
    get(key: string): string | null;
    getAll(key: string): string[];
    has(key: string): boolean;
    set(key: string, value: string): void;
    append(key: string, value: string): void;
    delete(key: string): void;
    toString(): string;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    forEach(callback: (value: string, key: string, self: URLSearchParams) => void): void;
  }
}
