export interface Issue {path: string; message: string}
export interface Validation {valid: boolean; errors: Issue[]; warnings?: Issue[]}
export const contract: Readonly<{contract: string; scope: string; sources: Record<string, string>; limits: {scriptBytes: number; resultBytes: number; responseBytes: number; bodyBytes: number; requests: number; timeoutMs: number}}>;
export const profiles: Readonly<Record<'common' | 'ios' | 'mac' | 'tv', Readonly<{name: string; engine: string; timers: boolean; nativeExtensions: string[]}>>>;
export const functionPattern: RegExp;
export function validateMetadata(metadata: unknown, availableFunctions?: string[]): Validation;
export function validateResult(value: unknown, kind?: 'list' | 'detail'): Validation;
