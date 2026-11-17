export type JSONValue = null | boolean | number | string | JSONValue[] | {[key: string]: JSONValue};
export type Parameters = Record<string, JSONValue | undefined>;
export type Identifier = string | number;
export interface Parameter {
  name: string;
  title?: string;
  type?: 'input' | 'constant' | 'enumeration' | 'count' | 'page' | 'offset' | 'search';
  value?: JSONValue;
  defaultValue?: JSONValue;
  required?: boolean;
  description?: string;
  belongTo?: string;
  placeholders?: {title?: string; value?: JSONValue}[];
  enumOptions?: {title: string; value: JSONValue}[];
}
export interface Module {
  id?: string;
  title: string;
  description?: string;
  functionName: string;
  type?: 'search' | 'detail' | 'stream' | 'resource';
  params?: Parameter[];
  cacheDuration?: number;
}
/** New authoring contract. Legacy imports remain handled by the App's parser. */
export interface Metadata {
  id: string;
  title: string;
  version: string;
  author?: string;
  description?: string;
  site?: string;
  requiredVersion?: string;
  detailCacheDuration?: number;
  globalParams?: Parameter[];
  modules: Module[];
  search?: Module;
  configCheckFunction?: string;
  denContentKind?: string;
  denReadingKind?: 'novel' | 'comic';
  denNativeKind?: 'youtube';
}
export interface PlaySource {
  id?: Identifier;
  title?: string;
  videoUrl: string;
  customHeaders?: Record<string, string>;
}
export interface MediaItem {
  id: Identifier;
  title: string;
  description?: string;
  link?: string;
  posterPath?: string;
  posterUrl?: string;
  backdropPath?: string;
  type?: 'url';
  mediaType?: 'movie' | 'tv';
  videoUrl?: string;
  customHeaders?: Record<string, string>;
  episodeNumber?: number;
  seasonNumber?: number;
  duration?: number;
  episodeItems?: MediaItem[];
  seasons?: MediaItem[];
  playSources?: PlaySource[];
}
/** Only a function named exactly loadDetail receives the host's string coercion. */
export type DetailArgument = string | {link: string; __parameters?: Parameters; toString(): string};
export interface HTTPOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: JSONValue;
  data?: JSONValue;
  /** Milliseconds; native request timeout is clamped to 3000–45000. */
  timeout?: number;
}
export interface HTTPResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  body: string;
  url: string;
  /** get() returns an empty string when absent, unlike browser Headers. */
  headers: {get(name: string): string} & {[key: string]: string[] | ((name: string) => string)};
  text(): Promise<string>;
  json<R = T>(): Promise<R>;
}
export interface ElementHandle {
  readonly textContent: string;
  getAttribute(name: string): string | null;
}
export interface HTMLSelection {
  readonly length: number;
  toArray(): ElementHandle[];
  first(): HTMLSelection;
  find(selector: string): HTMLSelection;
  closest(selector: string): HTMLSelection;
  attr(name: string): string | null;
  text(): string;
  /** This subset is not full Cheerio; each returns void. */
  each(callback: (index: number, element: ElementHandle) => void): void;
}
export interface DOMRecord {
  tag: string; text: string; html: string; outerHtml: string;
  attributes: Record<string, string>; attrs: Record<string, string>;
  id: string; className: string; classes: string[];
}
export interface WidgetHost {
  http: {
    get<T = unknown>(url: string, options?: HTTPOptions): Promise<HTTPResponse<T>>;
    head<T = unknown>(url: string, options?: HTTPOptions): Promise<HTTPResponse<T>>;
    post<T = unknown>(url: string, data?: JSONValue, options?: HTTPOptions): Promise<HTTPResponse<T>>;
    request<T = unknown>(options: HTTPOptions & {url: string}): Promise<HTTPResponse<T>>;
  };
  html: {load(html: string): (selector: string | ElementHandle) => HTMLSelection};
  dom: {
    parse(html: string): number;
    select(documentID: number, selector: string): DOMRecord[];
    text(node: DOMRecord | null): string;
    attr(node: DOMRecord | null, name: string): string | null;
    remove(documentID: number): boolean;
  };
  storage: {
    get<T extends JSONValue>(key: string, fallback: T): T;
    get(key: string): JSONValue | undefined;
    getAsync<T extends JSONValue>(key: string, fallback: T): Promise<T>;
    getAsync(key: string): Promise<JSONValue | undefined>;
    set(key: string, value: JSONValue): void;
    remove(key: string): void;
  };
}
