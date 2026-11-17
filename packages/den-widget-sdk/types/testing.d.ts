import type {JSONValue, Metadata} from './model.js';
import type {Validation} from './contract.js';
export type Profile = 'common' | 'ios' | 'mac' | 'tv';
export interface AbortLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', callback: () => void, options?: {once: boolean}): void;
  removeEventListener(type: 'abort', callback: () => void): void;
}
export interface Request {
  url: string; method: string; headers: Record<string, string>; body: string | null; timeout: number;
}
export interface FixtureResponse {
  status?: number;
  body?: string;
  bodyBase64?: string;
  data?: JSONValue;
  headers?: Record<string, string | string[]>;
  url?: string;
}
export interface Fixture extends FixtureResponse {url: string; method?: string}
export interface RunnerOptions {
  script: string;
  sourceURL?: string;
  profile?: Profile;
  timeoutMs?: number;
  storage?: Record<string, JSONValue>;
  /** Share the same object between runners to test cross-module cache access. */
  sharedCache?: Record<string, Record<string, JSONValue>>;
  signal?: AbortLike;
  /** Network is off by default. Exact origins only; redirects cannot cross origins. */
  allowNetwork?: string[];
  fixtures?: Fixture[] | ((request: Request, signal: AbortLike) => FixtureResponse | undefined | Promise<FixtureResponse | undefined>);
}
export interface Result<T = JSONValue> {
  value: T;
  storage: Record<string, JSONValue>;
  /** Known credential fields are redacted; arbitrary response values are not. */
  requests: Request[];
  availableFunctions: string[];
  profile: Profile;
}
export interface Inspection extends Result<Metadata> {metadata: Metadata; validation: Validation}
export interface Runner {
  readonly profile: Profile;
  getStorage(): Record<string, JSONValue>;
  getSharedCache(): Record<string, Record<string, JSONValue>>;
  inspect(): Promise<Inspection>;
  invoke<T = JSONValue>(functionName: string, argument?: JSONValue, kind?: 'list' | 'detail'): Promise<Result<T>>;
}
export class WidgetError extends Error {code: string; issues: {path: string; message: string}[]; constructor(code: string, message: string, issues?: {path: string; message: string}[])}
export function createRunner(options: RunnerOptions): Runner;
export function redact<T>(value: T): T;
