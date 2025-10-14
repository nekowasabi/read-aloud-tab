declare module 'cross-fetch' {
  const fetch: typeof globalThis.fetch;
  export default fetch;
  export const Headers: typeof globalThis.Headers;
  export const Request: typeof globalThis.Request;
  export const Response: typeof globalThis.Response;
}
