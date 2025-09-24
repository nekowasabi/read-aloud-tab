export interface ExtensionError {
  code: string;
  message: string;
  detail?: unknown;
}

export function createExtensionError(code: string, message: string, detail?: unknown): ExtensionError {
  return { code, message, detail };
}

export function formatErrorLog(code: string, message: string, detail?: unknown): [Record<string, unknown>, string] {
  return [{ code, detail }, message];
}
