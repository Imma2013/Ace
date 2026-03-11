const globalFetch = globalThis.fetch?.bind(globalThis);

export const fetch = globalFetch as typeof globalThis.fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export const File = globalThis.File;
export const Blob = globalThis.Blob;
export const WebSocket = globalThis.WebSocket;

export class Dispatcher {}
export class Agent extends Dispatcher {}
export class ProxyAgent extends Dispatcher {}
export class MockAgent extends Dispatcher {}
export class MockPool {}
export class MockClient {}
export class Pool extends Dispatcher {}
export class Client extends Dispatcher {}

export function setGlobalDispatcher(_dispatcher: unknown): void {}
export function getGlobalDispatcher(): undefined {
  return undefined;
}

export async function request(): Promise<never> {
  throw new Error('undici.request is unavailable in browser shim');
}
