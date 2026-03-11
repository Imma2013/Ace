function tag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value as ArrayBufferView);
}

export function isTypedArray(value: unknown): boolean {
  return /\[object (?:Uint|Int|Float|BigInt).+Array\]/.test(tag(value));
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

export function isNativeError(value: unknown): value is Error {
  return value instanceof Error;
}
