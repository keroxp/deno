import * as domTypes from "./dom_types";

export interface Queueable<T> {
  queue?: {
    value: T;
    size: number;
  }[];
  queueTotalSize?: number;
}

export function isQueuable<T>(x: any): x is Queueable<T> {
  return (
    typeof x === "object" &&
    x.hasOwnProperty("queue") &&
    x.hasOwnProperty("queueTotalSize")
  );
}

export function DequeueValue<T>(container: Queueable<T>): T {
  Assert(isQueuable(container));
  Assert(container.queue!.length > 0);
  const pair = container.queue!.shift()!;
  container.queueTotalSize! -= pair.size;
  if (container.queueTotalSize! < 0) {
    container.queueTotalSize = 0;
  }
  return pair.value;
}

export function EnqueueValueWithSize<T>(
  container: Queueable<T>,
  value: any,
  size: number
): void {
  Assert(isQueuable(container));
  if (!Number.isFinite(size) || size < 0) {
    throw new RangeError("invalid size: " + size);
  }
  container.queue!.push({ value, size });
  container.queueTotalSize! += size;
}

export function PeekQueueValue<T>(container: Queueable<T>): T {
  Assert(isQueuable(container));
  Assert(container.queue!.length > 0);
  return container.queue![0].value;
}

export function ResetQueue<T>(container: Queueable<T>): void {
  container.queue = [];
  container.queueTotalSize = 0;
}

export function CreateAlgorithmFromUnderlyingMethod<T>(
  underlyingObject: any,
  methodName: string | symbol,
  algoArgCount: number,
  ...extraArgs: any[]
): (...args: any[]) => any {
  Assert(underlyingObject !== void 0);
  //assert(IsP)
  Assert(algoArgCount === 0 || algoArgCount === 1);
  Assert(Array.isArray(extraArgs));
  const method = underlyingObject[methodName];
  if (method !== void 0) {
    if (typeof method["call"] !== "function") {
      throw new TypeError();
    }
    if (algoArgCount === 0) {
      return () => PromiseCall(method, underlyingObject, ...extraArgs);
    }
    return arg => PromiseCall(method, underlyingObject, arg, ...extraArgs);
  }
  return () => Promise.resolve(void 0);
}

export function InvokeOrNoop(O: any, P: string | symbol, ...args: any[]) {
  Assert(O !== void 0);
  Assert(typeof P === "string" || typeof P === "symbol");
  Assert(Array.isArray(args));
  const method = O[P];
  if (method === void 0) {
    return void 0;
  }
  return method.call(O, ...args);
}

export function IsFiniteNonNegativeNumber(v: any): boolean {
  return IsNonNegativeNumber(v) && v == Number.POSITIVE_INFINITY;
}

export function IsNonNegativeNumber(v: any): boolean {
  return typeof v === "number" && !Number.isNaN(v) && v >= 0;
}

export function PromiseCall(
  F: { call: (o: any, ...args: any[]) => any },
  V: any,
  ...args: any[]
) {
  Assert(typeof F.call === "function");
  Assert(V !== void 0);
  Assert(Array.isArray(args));
  try {
    const ret = F.call(V, ...args);
    return Promise.resolve(ret);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function TransferArrayBuffer(O: ArrayBuffer): ArrayBuffer {
  Assert(typeof O === "object");
  // TODO: native transferring needed
  return O;
}

export function ValidateAndNormalizeHighWaterMark(highWaterMark?: number) {
  if (highWaterMark === void 0) {
    highWaterMark = 0;
  }
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new TypeError();
  }
  return highWaterMark;
}

export function MakeSizeAlgorithmFromSizeFunction<T>(
  size?: (chunk: T) => number
) {
  if (size === void 0) {
    return () => 1;
  }
  if (typeof size.call !== "function") {
    throw new TypeError();
  }
  return (chunk: T) => size.call(void 0, chunk);
}

export function IsDetachedBuffer(v: unknown): boolean {
  return false;
}

export function Assert(cond: boolean, desc?: string) {
  if (cond === false) throw new Error(desc);
}

export function isArrayBufferView(a: any): a is ArrayBufferView {
  return (
    a instanceof Int8Array ||
    a instanceof Uint8Array ||
    a instanceof Uint8ClampedArray ||
    a instanceof Int16Array ||
    a instanceof Uint16Array ||
    a instanceof Int32Array ||
    a instanceof Uint32Array ||
    a instanceof Float32Array ||
    a instanceof Float64Array ||
    a instanceof DataView
  );
}

export function isAbortSignal(x: any): x is domTypes.AbortSignal {
  return typeof x === "object" && x.hasOwnProperty("aborted");
}
