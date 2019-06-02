import * as domTypes from "../dom_types";
import { Assert, isAbortSignal, ResetQueue, TransferArrayBuffer, IsFiniteNonNegativeNumber, CreateAlgorithmFromUnderlyingMethod, IsDetachedBuffer, DequeueValue, EnqueueValueWithSize, InvokeOrNoop } from "./misc";
import {
  IsNonNegativeNumber,
  MakeSizeAlgorithmFromSizeFunction,
  ValidateAndNormalizeHighWaterMark,
  isArrayBufferView
} from "./misc";
import { defer } from "../defer";
import * as writableStream from "./writable_stream";
import {
  AcquireWritableStreamDefaultWriter,
  IsWritableStream,
  IsWritableStreamLocked,
  WritableStreamAbort,
  WritableStreamCloseQueuedOrInFlight
} from "./writable_stream";
import {
  WritableStreamDefaultWriterCloseWithErrorPropagation,
  WritableStreamDefaultWriterGetDesiredSize,
  WritableStreamDefaultWriterRelease
} from "./writable_stream";

export class ReadableStream<T = any> implements domTypes.ReadableStream<T> {
  disturbed: boolean = false;
  readableStreamController?:
    | ReadableByteStreamController
    | ReadableStreamDefaultController<T>;
  reader?: ReadableStreamDefaultReader | ReadableStreamBYOBReader;
  state?: "readable" | "closed" | "errored";
  storedError?: Error;

  constructor(
    underlyingSource: domTypes.UnderlyingSource<T> = {},
    strategy: domTypes.QueuingStrategy = {}
  ) {
    InitializeReadableStream(this);
    let { highWaterMark, size } = strategy;
    const { type } = underlyingSource;
    if (type === "bytes") {
      if (size !== void 0) {
        throw new RangeError();
      }
      if (highWaterMark === void 0) {
        highWaterMark = 0;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);
      SetUpReadableByteStreamControllerFromUnderlyingSource(
        this,
        underlyingSource,
        highWaterMark
      );
    } else if (type === void 0) {
      const sizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(size);
      if (highWaterMark === void 0) {
        highWaterMark = 0;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);
      SetUpReadableStreamDefaultControllerFromUnderlyingSource({
        stream: this,
        underlyingSource,
        highWaterMark,
        sizeAlgorithm
      });
    } else {
      throw new RangeError();
    }
  }

  get locked(): boolean {
    if (!IsReadableStream(this)) {
      throw new TypeError();
    }
    return IsReadableStreamLocked(this);
  }

  cancel(reason?): Promise<void> {
    if (IsReadableStream(this)) {
      return Promise.reject(new TypeError());
    }
    if (IsReadableStreamLocked(this)) {
      return Promise.reject(new TypeError());
    }
    return ReadableStreamCancel(this, reason);
  }

  getReader<M extends "byob">(params: {
    mode?: M;
  }): {
    byob: domTypes.ReadableStreamBYOBReader;
    undefined: domTypes.ReadableStreamReader<T>;
  }[M] {
    if (!IsReadableStream(this)) {
      throw new TypeError();
    }
    if (params.mode === void 0) {
      return AcquireReadableStreamDefaultReader(this);
    }
    if (params.mode === "byob") {
      return AcquireReadableStreamBYOBReader(this);
    }
    throw new RangeError();
  }

  pipeThrough(
    {
      writable,
      readable
    }: {
      writable: domTypes.WritableStream<T>;
      readable: domTypes.ReadableStream<T>;
    },
    {
      preventClose,
      preventAbort,
      preventCancel,
      signal
    }: {
      preventClose?: boolean;
      preventAbort?: boolean;
      preventCancel?: boolean;
      signal?: domTypes.AbortSignal;
    } = {}
  ): domTypes.ReadableStream<T> {
    if (!IsReadableStream(this)) {
      throw new TypeError("this is not ReadableStream");
    }
    if (!IsWritableStream(writable)) {
      throw new TypeError("writable is not WritableStream");
    }
    if (!IsReadableStream(readable)) {
      throw new TypeError("readable is not ReadableStream");
    }
    preventClose = !!preventClose;
    preventAbort = !!preventAbort;
    preventCancel = !!preventCancel;
    if (signal !== void 0 && !isAbortSignal(signal)) {
      throw new TypeError("signal is not instance of AbortSignal");
    }
    if (IsReadableStreamLocked(this)) {
      throw new TypeError("this stream is locked");
    }
    if (IsWritableStreamLocked(writable)) {
      throw new TypeError("writable is locked");
    }
    ReadableStreamPipeTo(
      this,
      writable,
      preventClose,
      preventAbort,
      preventCancel,
      signal
    );
    return readable;
  }

  async pipeTo(
    dest: domTypes.WritableStream<T>,
    {
      preventClose,
      preventAbort,
      preventCancel,
      signal
    }: {
      preventClose?: boolean;
      preventAbort?: boolean;
      preventCancel?: boolean;
      signal?: domTypes.AbortSignal;
    } = {}
  ): Promise<void> {
    if (!IsReadableStream(this)) {
      throw new TypeError("this is not ReadableStream");
    }
    if (!IsWritableStream(dest)) {
      throw new TypeError("dest is not WritableStream");
    }
    preventClose = !!preventClose;
    preventAbort = !!preventAbort;
    preventCancel = !!preventCancel;
    if (signal !== void 0 && !isAbortSignal(signal)) {
      throw new TypeError("signal is not instance of AbortSignal");
    }
    if (IsReadableStreamLocked(this)) {
      throw new TypeError("this stream is locked");
    }
    if (IsWritableStreamLocked(dest)) {
      throw new TypeError("writable is locked");
    }
    return ReadableStreamPipeTo(
      this,
      dest,
      preventClose,
      preventCancel,
      preventAbort,
      signal
    );
  }

  tee(): [domTypes.ReadableStream<T>, domTypes.ReadableStream<T>] {
    if (!IsReadableStream(this)) {
      throw new TypeError();
    }
    return ReadableStreamTee(this, false);
  }
}

function AcquireReadableStreamBYOBReader(
  stream: ReadableStream
): ReadableStreamBYOBReader {
  return new ReadableStreamBYOBReader(stream);
}

function AcquireReadableStreamDefaultReader(
  stream: ReadableStream
): ReadableStreamDefaultReader {
  return new ReadableStreamDefaultReader(stream);
}

export function CreateReadableStream(
  startAlgorithm: domTypes.StartAlgorithm,
  pullAlgorithm: domTypes.PullAlgorithm,
  cancelAlgorithm: domTypes.CancelAlgorithm,
  highWaterMark: number = 1,
  sizeAlgorithm: domTypes.SizeAlgorithm = () => 1
): ReadableStream {
  Assert(IsNonNegativeNumber(highWaterMark));
  const stream = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);
  const controller = Object.create(ReadableStreamDefaultController.prototype);
  SetUpReadableStreamDefaultController({
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm
  });
  return stream;
}

export function CreateReadableByteStream(
  startAlgorithm: domTypes.StartAlgorithm,
  pullAlgorithm: domTypes.PullAlgorithm,
  cancelAlgorithm: domTypes.CancelAlgorithm,
  highWaterMark: number = 1,
  autoAllocateChunkSize?: number
) {
  Assert(IsNonNegativeNumber(highWaterMark));
  if (autoAllocateChunkSize !== void 0) {
    Assert(Number.isInteger(autoAllocateChunkSize));
    Assert(autoAllocateChunkSize > 0);
  }
  const stream = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);
  const controller = Object.create(ReadableByteStreamController.prototype);
  SetUpReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize
  );
  return stream;
}

export function InitializeReadableStream(stream: ReadableStream) {
  stream.state = "readable";
  stream.reader = void 0;
  stream.storedError = void 0;
  stream.disturbed = false;
}

export function IsReadableStream(x): x is ReadableStream {
  return typeof x === "object" && x.hasOwnProperty("readableStreamController");
}

export function IsReadableStreamDisturbed(stream: ReadableStream): boolean {
  Assert(IsReadableStream(stream));
  return stream.disturbed;
}

export function IsReadableStreamLocked(stream: ReadableStream): boolean {
  Assert(IsReadableStream(stream));
  return stream.reader !== void 0;
}

export function ReadableStreamTee<T>(
  stream: ReadableStream<T>,
  cloneForBranch2: boolean
): [domTypes.ReadableStream<T>, domTypes.ReadableStream<T>] {
  Assert(IsReadableStream(stream));
  Assert(typeof cloneForBranch2 === "boolean");
  const reader = AcquireReadableStreamDefaultReader(stream);
  let closedOrErrored = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1 = void 0;
  let reason2 = void 0;
  let branch1: ReadableStream<T> = void 0;
  let branch2: ReadableStream<T> = void 0;
  let cancelPromise = defer();
  const pullAlgorithm: domTypes.PullAlgorithm = () => {
    return ReadableStreamDefaultReaderRead(reader).then(
      (result: { value; done: boolean }) => {
        Assert(typeof result === "object");
        const { value, done } = result;
        Assert(typeof done === "boolean");
        if (done && !closedOrErrored) {
          if (!canceled1) {
            ReadableStreamDefaultControllerClose(
              branch1.readableStreamController
            );
          }
          if (!canceled2) {
            ReadableStreamDefaultControllerClose(
              branch2.readableStreamController
            );
          }
        }
        if (closedOrErrored) {
          return;
        }
        let [value1, value2] = [value, value];
        if (!canceled2 && cloneForBranch2) {
          //value2 <- ?StructuredDeserialize( ? StructuredSerialize( value2 ), 現在の Realm Record )
        }
        if (!canceled1) {
          ReadableStreamDefaultControllerEnqueue(
            branch1.readableStreamController,
            value1
          );
        }
        if (!canceled2) {
          ReadableStreamDefaultControllerEnqueue(
            branch1.readableStreamController,
            value2
          );
        }
      }
    );
  };
  const cancel1Algorithm: domTypes.CancelAlgorithm = reason => {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) {
      const compositeReason = [reason1, reason2];
      // TODO: ambiguous spec https://streams.spec.whatwg.org/#readable-stream-tee
      // what is cancelPromise type?
      ReadableStreamCancel(stream, compositeReason).then(() => {
        cancelPromise.resolve();
      });
    }
    return cancelPromise;
  };
  const cancel2Algorithm: domTypes.CancelAlgorithm = reason => {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) {
      const compositeReason = [reason1, reason2];
      ReadableStreamCancel(stream, compositeReason).then(() => {
        cancelPromise.resolve();
      });
    }
    return cancelPromise;
  };
  const startAlgorithm: domTypes.StartAlgorithm = () => void 0;
  branch1 = CreateReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancel1Algorithm
  );
  branch2 = CreateReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancel2Algorithm
  );
  reader.closedPromise.catch(r => {
    if (!closedOrErrored) {
      ReadableStreamDefaultControllerError(branch1.readableStreamController, r);
      ReadableStreamDefaultControllerError(branch2.readableStreamController, r);
      closedOrErrored = true;
    }
  });
  return [branch1, branch2];
}

export async function ReadableStreamPipeTo(
  source: ReadableStream,
  dest: writableStream.WritableStream,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal?: domTypes.AbortSignal
): Promise<void> {
  Assert(IsReadableStream(source));
  Assert(IsWritableStream(dest));
  Assert(typeof preventCancel === "boolean");
  Assert(typeof preventAbort === "boolean");
  Assert(typeof preventClose === "boolean");
  Assert(signal === void 0 || isAbortSignal(signal));
  Assert(!IsReadableStreamLocked(source));
  Assert(!IsWritableStreamLocked(dest));
  let reader:
    | ReadableStreamBYOBReader
    | ReadableStreamDefaultReader;
  if (IsReadableByteStreamController(source.readableStreamController)) {
    reader = AcquireReadableStreamBYOBReader(source);
  } else {
    reader = AcquireReadableStreamDefaultReader(source);
  }
  const writer = AcquireWritableStreamDefaultWriter(dest);
  let shutingDown = false;
  const promsie = defer();
  let abortAlgorithm: domTypes.AbortAlgorithm;
  if (signal) {
    abortAlgorithm = async () => {
      let error = new Error("aborted");
      const actions: (() => Promise<any>)[] = [];
      if (!preventAbort) {
        actions.push(async () => {
          if (dest.state === "writable") {
            return WritableStreamAbort(dest, error);
          }
          return void 0;
        });
      }
      if (!preventCancel) {
        actions.push(async () => {
          if (source.state === "readable") {
            return ReadableStreamCancel(source, error);
          }
          return void 0;
        });
      }
      shutdown(error, () => Promise.all(actions.map(p => p())));
      if (signal.aborted) {
        abortAlgorithm();
        return promsie;
      }
      signal.addEventListener("onabort", abortAlgorithm);
    };
  }
  const finalize = (error?: any) => {
    WritableStreamDefaultWriterRelease(writer);
    ReadableStreamReaderGenericRelease(reader);
    if (signal) {
      signal.removeEventListener("onabort", abortAlgorithm);
    }
    if (error) {
      promsie.reject(error);
    } else {
      promsie.resolve();
    }
  };
  const shutdown = (err?, action?: () => Promise<any>) => {
    if (shutingDown) {
      return;
    }
    shutingDown = true;
    if (
      dest.state === "writable" ||
      !WritableStreamCloseQueuedOrInFlight(dest)
    ) {
    }
    if (!action) {
      finalize(err);
      return;
    }
    action()
      .then(() => finalize(err))
      .catch(finalize);
  };
  (async () => {
    while (true) {
      const desiredSize = WritableStreamDefaultWriterGetDesiredSize(writer);
      if (desiredSize === null || desiredSize <= 0) {
        return;
      }
      if (source.state === "errored") {
        if (!preventAbort) {
          shutdown(source.storedError, () => {
            return WritableStreamAbort(dest, source.storedError);
          });
        } else {
          shutdown(source.storedError);
        }
      } else if (dest.state === "errored") {
        if (!preventCancel) {
          shutdown(dest.storedError, () => {
            return ReadableStreamCancel(source, dest.storedError);
          });
        } else {
          shutdown(dest.storedError);
        }
      } else if (source.state === "closed") {
        if (!preventClose) {
          shutdown(void 0, () => {
            return WritableStreamDefaultWriterCloseWithErrorPropagation(writer);
          });
        } else {
          shutdown();
        }
      } else if (
        WritableStreamCloseQueuedOrInFlight(dest) ||
        dest.state === "closed"
      ) {
        const destClosed = new TypeError();
        if (!preventCancel) {
          shutdown(destClosed, () => {
            return ReadableStreamCancel(source, destClosed);
          });
        } else {
          shutdown(destClosed);
        }
      }
      if (reader instanceof ReadableStreamBYOBReader) {
        let view = new Uint8Array(desiredSize);
        const { done } = await reader.read(view);
        if (done) break;
        await writer.write(view);
      } else {
        const { value, done } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    }
  })();
  return promsie;
}

export function ReadableStreamAddReadIntoRequest(
  stream: ReadableStream,
  forAuthorCode: boolean
) {
  Assert(IsReadableStreamBYOBReader(stream.reader));
  const reader = stream.reader as ReadableStreamBYOBReader;
  Assert(stream.state === "readable" || stream.state === "closed");
  const promise = defer();
  const readIntoRequest = { promise, forAuthorCode };
  reader.readIntoRequests.push(readIntoRequest);
  return promise;
}

export function ReadableStreamAddReadRequest(
  stream: ReadableStream,
  forAuthorCode: boolean
): Promise<{ value; done: boolean }> {
  Assert(IsReadableStreamDefaultReader(stream.reader));
  const reader = stream.reader as ReadableStreamDefaultReader;
  Assert(stream.state === "readable" || stream.state === "closed");
  const promise = defer<{ value; done: boolean }>();
  const readIntoRequest = { promise, forAuthorCode };
  reader.readRequests.push(readIntoRequest);
  return promise;
}

export function ReadableStreamCancel(
  stream: ReadableStream,
  reason: any
): Promise<undefined> {
  stream.disturbed = true;
  if (stream.state === "closed") {
    return Promise.reject(void 0);
  }
  if (stream.state === "errored") {
    return Promise.reject(stream.storedError);
  }
  ReadableStreamClose(stream);
  const sourceCancelPromise = stream.readableStreamController.cancelAlgorithm(
    reason
  );
  return sourceCancelPromise.then(() => void 0);
}

export function ReadableStreamClose(stream: ReadableStream) {
  Assert(stream.state === "readable");
  stream.state = "closed";
  const reader = stream.reader;
  if (reader === void 0) {
    return;
  }
  if (IsReadableStreamDefaultReader(reader)) {
    for (let req of reader.readRequests) {
      const resolved = ReadableStreamCreateReadResult(
        void 0,
        true,
        req.forAuthorCode
      );
      req.promise.resolve(resolved);
    }
    reader.readRequests = [];
  }
  reader.closedPromise.resolve(void 0);
}

export function ReadableStreamCreateReadResult<T>(
  value,
  done: boolean,
  forAuthorCode: boolean
): domTypes.ReadableStreamReadResult<T> {
  const ret = forAuthorCode ? Object.create({}) : Object.create(null);
  ret["value"] = value as T;
  ret["done"] = done;
  return { value, done };
}

export function ReadableStreamError(stream: ReadableStream, e) {
  Assert(IsReadableStream(stream));
  Assert(stream.state === "readable");
  stream.state = "errored";
  stream.storedError = e;
  const reader = stream.reader;
  if (stream.reader === void 0) {
    return;
  }
  if (IsReadableStreamDefaultReader(reader)) {
    for (const req of reader.readRequests) {
      req.promise.reject(e);
    }
    reader.readRequests = [];
  } else if (IsReadableStreamBYOBReader(reader)) {
    for (const req of reader.readIntoRequests) {
      req.promise.reject(e);
    }
    reader.readIntoRequests = [];
  }
  reader.closedPromise.reject(e);
  //TODO: Set reader.[[closedPromise]].[[PromiseIsHandled]] to true.
}

export function ReadableStreamFulfillReadIntoRequest(
  stream: ReadableStream,
  chunk,
  done
) {
  const reader = stream.reader;
  const req = (<ReadableStreamBYOBReader>reader).readIntoRequests.shift();
  req.promise.resolve(
    ReadableStreamCreateReadResult(chunk, done, req.forAuthorCode)
  );
}

export function ReadableStreamFulfillReadRequest<T>(
  stream: ReadableStream,
  chunk,
  done
) {
  const reader = stream.reader;
  const req = (<ReadableStreamDefaultReader<T>>reader).readRequests.shift();
  req.promise.resolve(
    ReadableStreamCreateReadResult(chunk, done, req.forAuthorCode)
  );
}

export function ReadableStreamGetNumReadIntoRequests(stream: ReadableStream) {
  return (<ReadableStreamBYOBReader>stream.reader).readIntoRequests.length;
}

export function ReadableStreamGetNumReadRequests<T>(stream) {
  return (<ReadableStreamDefaultReader<T>>stream.reader).readRequests.length;
}

export function ReadableStreamHasBYOBReader(stream: ReadableStream): boolean {
  const reader = stream.reader;
  if (reader === void 0) {
    return false;
  }
  return IsReadableStreamBYOBReader(reader);
}

export function ReadableStreamHasDefaultReader(stream): boolean {
  const reader = stream.reader;
  if (reader === void 0) {
    return false;
  }
  return IsReadableStreamDefaultReader(reader);
}

// reader

export class ReadableStreamDefaultReader<T = any>
  implements domTypes.ReadableStreamReader<T> {
  readRequests?: { 
    promise: domTypes.Defer<any>; 
    forAuthorCode: boolean
   }[];
  closedPromise: domTypes.Defer<void>;
  ownerReadableStream?: ReadableStream;

  constructor(stream: ReadableStream) {
    if (!IsReadableStream(stream)) {
      throw new TypeError();
    }
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError();
    }
    //ReadableStreamReaderGenericInitialize(this, stream);
    this.ownerReadableStream = stream;
    stream.reader = this;
    if (stream.state === "readable") {
      this.closedPromise = defer();
    } else if (stream.state === "closed") {
      this.closedPromise = defer();
      this.closedPromise.resolve(void 0);
    } else {
      Assert(stream.state === "errored");
      this.closedPromise = defer();
      this.closedPromise.reject(stream.storedError);
    }
    this.readRequests = [];
  }

  get closed(): Promise<void> {
    if (!IsReadableStreamDefaultReader(this)) {
      return Promise.reject(new TypeError());
    }
    return this.closedPromise;
  }

  cancel(reason?: any): Promise<void> {
    if (!IsReadableStreamDefaultReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    return ReadableStreamReaderGenericCancel(this, reason);
  }

  read(): Promise<domTypes.ReadableStreamReadResult<T>> {
    if (!IsReadableStreamDefaultReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    return ReadableStreamDefaultReaderRead(this, true);
  }

  async releaseLock(): Promise<any> {
    if (!IsReadableStreamDefaultReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    if (this.readRequests.length > 0) {
      throw new TypeError();
    }
    ReadableStreamReaderGenericRelease(this);
  }
}

export function IsReadableStreamDefaultReader<T>(
  a: any
): a is ReadableStreamDefaultReader<T> {
  return typeof a === "object" && a.hasOwnProperty("readRequests");
}

export function ReadableStreamReaderGenericCancel<T>(
  reader:
    | ReadableStreamBYOBReader
    | ReadableStreamDefaultReader<T>,
  reason?: any
) {
  const stream = reader.ownerReadableStream;
  Assert(stream !== void 0);
  return ReadableStreamCancel(stream, reason);
}

export function ReadableStreamReaderGenericInitialize<T>(
  reader: ReadableStreamBYOBReader | ReadableStreamDefaultReader<T>,
  stream: ReadableStream
) {
  reader.ownerReadableStream = stream;
  stream.reader = reader;
  if (stream.state === "readable") {
    reader.closedPromise = defer();
  } else if (stream.state === "closed") {
    reader.closedPromise = defer();
    reader.closedPromise.resolve(void 0);
  } else {
    Assert(stream.state === "errored");
    reader.closedPromise = defer();
    reader.closedPromise.reject(stream.storedError);
  }
}

export function ReadableStreamReaderGenericRelease<T>(
  reader: ReadableStreamBYOBReader | ReadableStreamDefaultReader<T>
) {
  Assert(reader.ownerReadableStream !== void 0);
  Assert(reader.ownerReadableStream.reader === reader);
  if (reader.ownerReadableStream.state === "readable") {
    reader.closedPromise.reject(new TypeError());
  } else {
    reader.closedPromise.reject(new TypeError());
  }
  reader.ownerReadableStream.reader = void 0;
  reader.ownerReadableStream = void 0;
}

export function ReadableStreamDefaultReaderRead<T>(
  reader: ReadableStreamDefaultReader<T>,
  forAuthorCode: boolean = false
): Promise<{ value; done: boolean }> {
  const stream = reader.ownerReadableStream;
  Assert(stream !== void 0);
  stream.disturbed = true;
  if (stream.state === "closed") {
    return Promise.resolve(
      ReadableStreamCreateReadResult(void 0, true, forAuthorCode)
    );
  }
  if (stream.state === "errored") {
    return Promise.reject(stream.storedError);
  }
  Assert(stream.state === "readable");
  return stream.readableStreamController.PullSteps(forAuthorCode);
}

// request
export class ReadableStreamBYOBRequestImpl
  implements domTypes.ReadableStreamBYOBRequest {
  constructor() {
    throw new TypeError();
  }

  associatedReadableByteStreamController: ReadableByteStreamController;
  _view: Uint8Array;
  get view(): Uint8Array {
    if (!IsReadableStreamBYOBRequest(this)) {
      throw new TypeError();
    }
    return this._view;
  }

  respond(bytesWritten: number) {
    if (!IsReadableStreamBYOBRequest(this)) {
      throw new TypeError();
    }
    if (this.associatedReadableByteStreamController === void 0) {
      throw new TypeError();
    }
    if (IsDetachedBuffer(this._view)) {
      throw new TypeError();
    }
    return ReadableByteStreamControllerRespond(
      this.associatedReadableByteStreamController,
      bytesWritten
    );
  }

  respondWithNewView(view: any) {
    if (!IsReadableStreamBYOBRequest(this)) {
      throw new TypeError();
    }
    if (this.associatedReadableByteStreamController === void 0) {
      throw new TypeError();
    }
    if (typeof view !== "object") {
      throw new TypeError();
    }
    // if (view.hasOwnProperty("ViewedArrayBuffer")) {
    //   throw new TypeError();
    // }
    if (IsDetachedBuffer(this._view)) {
      throw new TypeError();
    }
    return ReadableByteStreamControllerRespondWithNewView(
      this.associatedReadableByteStreamController,
      view
    );
  }
}

export function IsReadableStreamBYOBRequest(
  x: any
): x is domTypes.ReadableStreamBYOBRequest {
  return (
    typeof x === "object" &&
    x.hasOwnProperty("associatedReadableByteStreamController")
  );
}

export function SetUpReadableStreamBYOBRequest(
  request: ReadableStreamBYOBRequestImpl,
  controller: ReadableByteStreamController,
  view: any
) {
  Assert(IsReadableByteStreamController(controller));
  Assert(typeof view === "object");
  Assert(view.hasOwnProperty("ViewedArrayBuffer"));
  Assert(view.ViewedArrayBuffer !== null);
  request.associatedReadableByteStreamController = controller;
  request._view = view;
}

// controller
export type PullIntoDescriptor = {
  buffer: ArrayBuffer;
  byteOffset: number;
  bytesFilled: number;
  byteLength: number;
  elementSize: number;
  ctor: any;
  readerType: string;
};

export abstract class ReadableStreamControllerBase {
  autoAllocateChunkSize: number;
  cancelAlgorithm?: domTypes.CancelAlgorithm;
  closeRequested: boolean;
  pullAgain: boolean;

  pullAlgorithm?: domTypes.PullAlgorithm;

  pulling: boolean;
  pendingPullIntos: PullIntoDescriptor[];
  queue: {
    buffer: ArrayBuffer;
    byteLength: number;
    byteOffset: number;
  }[];
  queueTotalSize;
  started: boolean;
  strategyHWM: number;
}

export class ReadableStreamDefaultController<T>
  extends ReadableStreamControllerBase
  implements domTypes.ReadableStreamController<T> {
  constructor() {
    super();
    throw new TypeError();
  }

  controlledReadableStream: ReadableStream;
  strategySizeAlgorithm: (chunk) => number;

  get desiredSize(): number|null {
    if (!IsReadableStreamDefaultController(this)) {
      throw new TypeError();
    }
    return ReadableStreamDefaultControllerGetDesiredSize(this);
  }

  close(): void {
    if (!IsReadableStreamDefaultController(this)) {
      throw new TypeError();
    }
    if (!ReadableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError();
    }
    ReadableStreamDefaultControllerClose(this);
  }

  enqueue(chunk: T): void {
    if (!IsReadableStreamDefaultController(this)) {
      throw new TypeError();
    }
    if (!ReadableStreamDefaultControllerCanCloseOrEnqueue(this)) {
      throw new TypeError();
    }
    return ReadableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(e): void {
    if (!IsReadableStreamDefaultController(this)) {
      throw new TypeError();
    }
    ReadableStreamDefaultControllerError(this, e);
  }

  CancelSteps(reason): Promise<any> {
    ResetQueue(this);
    const result = this.cancelAlgorithm(reason);
    ReadableStreamDefaultControllerClearAlgorithms(this);
    return result;
  }

  PullSteps(forAuthorCode?: boolean): Promise<any> {
    const stream = this.controlledReadableStream;
    if (this.queue.length > 0) {
      const chunk = DequeueValue(this);
      if (this.closeRequested && this.queue.length === 0) {
        ReadableStreamDefaultControllerClearAlgorithms(this);
        ReadableStreamClose(stream);
      } else {
        ReadableStreamDefaultControllerCallPullIfNeeded(this);
      }
      return Promise.resolve(
        ReadableStreamCreateReadResult(chunk, false, forAuthorCode)
      );
    }
    const pendingPromise = ReadableStreamAddReadRequest(stream, forAuthorCode);
    ReadableStreamDefaultControllerCallPullIfNeeded(this);
    return pendingPromise;
  }
}

export function IsReadableStreamDefaultController<T>(
  x
): x is ReadableStreamDefaultController<T> {
  return typeof x === "object" && x.hasOwnProperty("controlledReadableStream");
}

export function ReadableStreamDefaultControllerCallPullIfNeeded<T>(
  controller: ReadableStreamDefaultController<T>
) {
  const shouldPull = ReadableStreamDefaultControllerShouldCallPull(controller);
  if (!shouldPull) {
    return;
  }
  if (controller.pulling) {
    controller.pullAgain = true;
    return;
  }
  Assert(!controller.pullAgain);
  controller.pulling = true;
  controller
    .pullAlgorithm()
    .then(() => {
      controller.pulling = false;
      if (controller.pullAgain) {
        controller.pullAgain = false;
        ReadableStreamDefaultControllerCallPullIfNeeded(controller);
      }
    })
    .catch(r => {
      ReadableStreamDefaultControllerError(controller, r);
    });
}

export function ReadableStreamDefaultControllerShouldCallPull<T>(
  controller: ReadableStreamDefaultController<T>
) {
  const stream = controller.controlledReadableStream;
  if (!ReadableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
    return false;
  }
  if (!controller.started) {
    return false;
  }
  if (
    IsReadableStreamLocked(stream) &&
    ReadableStreamGetNumReadRequests(stream) > 0
  ) {
    return true;
  }
  const desiredSize = ReadableStreamDefaultControllerGetDesiredSize(controller);
  Assert(desiredSize !== null);
  return desiredSize! > 0;
}

export function ReadableStreamDefaultControllerClearAlgorithms<T>(
  controller: ReadableStreamDefaultController<T>
) {
  controller.pullAlgorithm = void 0;
  controller.cancelAlgorithm = void 0;
  controller.strategySizeAlgorithm = void 0;
}

export function ReadableStreamDefaultControllerClose<T>(controller) {
  const stream = controller.controlledReadableStream;
  Assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(controller));
  controller.closeRequested = true;
  if (controller.queue.length === 0) {
    ReadableStreamDefaultControllerClearAlgorithms(controller);
    ReadableStreamClose(stream);
  }
}

export function ReadableStreamDefaultControllerEnqueue<T>(controller, chunk) {
  if (IsReadableStreamDefaultController(controller)) {
    const stream = controller.controlledReadableStream;
    Assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(controller));
    if (
      IsReadableStreamLocked(stream) &&
      ReadableStreamGetNumReadRequests(stream) > 0
    ) {
      ReadableStreamFulfillReadRequest(stream, chunk, false);
    } else {
      let result: number;
      try {
        result = controller.strategySizeAlgorithm(chunk);
      } catch (e) {
        ReadableStreamDefaultControllerError(controller, e);
        return e;
      }
      const chunkSize = result;
      try {
        EnqueueValueWithSize(controller, chunk, chunkSize);
      } catch (e) {
        ReadableStreamDefaultControllerError(controller, e);
        return e;
      }
      ReadableStreamDefaultControllerCallPullIfNeeded(controller);
    }
  }
}

export function ReadableStreamDefaultControllerError<T>(controller, e) {
  if (IsReadableStreamDefaultController(controller)) {
    const stream = controller.controlledReadableStream;
    if (stream.state !== "readable") {
      return;
    }
    ResetQueue(controller);
    ReadableStreamDefaultControllerClearAlgorithms(controller);
    ReadableStreamError(stream, e);
  }
}

export function ReadableStreamDefaultControllerGetDesiredSize<T>(
  controller: ReadableStreamDefaultController<T>
): number | null {
  const stream = controller.controlledReadableStream;
  const state = stream.state;
  if (state === "errored") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return controller.strategyHWM - controller.queueTotalSize;
}

export function ReadableStreamDefaultControllerHasBackpressure<T>(
  controller: ReadableStreamDefaultController<T>
): boolean {
  return !ReadableStreamDefaultControllerShouldCallPull(controller);
}

export function ReadableStreamDefaultControllerCanCloseOrEnqueue<T>(
  controller: ReadableStreamDefaultController<T>
): boolean {
  const state = controller.controlledReadableStream.state;
  return !controller.closeRequested && state === "readable";
}

export function SetUpReadableStreamDefaultController<T>(params: {
  stream: ReadableStream;
  controller: ReadableStreamDefaultController<T>;
  startAlgorithm: domTypes.StartAlgorithm;
  pullAlgorithm: domTypes.PullAlgorithm;
  cancelAlgorithm: domTypes.CancelAlgorithm;
  highWaterMark: number;
  sizeAlgorithm: domTypes.SizeAlgorithm;
}) {
  const {
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm
  } = params;
  let { highWaterMark, sizeAlgorithm } = params;
  Assert(stream.readableStreamController === void 0);
  controller.controlledReadableStream = stream;
  controller.queue = void 0;
  controller.queueTotalSize = void 0;
  ResetQueue(controller);
  controller.started = false;
  controller.closeRequested = false;
  controller.pullAgain = false;
  controller.pulling = false;
  controller.strategySizeAlgorithm = sizeAlgorithm;
  controller.strategyHWM = highWaterMark;
  controller.pullAlgorithm = pullAlgorithm;
  controller.cancelAlgorithm = cancelAlgorithm;
  stream.readableStreamController = controller;
  Promise.resolve(startAlgorithm())
    .then(() => {
      controller.started = true;
      Assert(controller.pulling == false);
      Assert(controller.pullAgain == false);
      ReadableStreamDefaultControllerCallPullIfNeeded(controller);
    })
    .catch(r => {
      ReadableStreamDefaultControllerError(controller, r);
    });
}

export function SetUpReadableStreamDefaultControllerFromUnderlyingSource(params: {
  stream: ReadableStream;
  underlyingSource: domTypes.UnderlyingSource;
  highWaterMark: number;
  sizeAlgorithm: domTypes.SizeAlgorithm;
}) {
  const { stream, underlyingSource, highWaterMark, sizeAlgorithm } = params;
  Assert(underlyingSource !== void 0);
  const controller = Object.create(ReadableStreamDefaultController.prototype);
  const startAlgorithm = () =>
    InvokeOrNoop(underlyingSource, "start", controller);
  const pullAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingSource,
    "pull",
    0,
    controller
  );
  const cancelAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingSource,
    "cancel",
    1
  );
  SetUpReadableStreamDefaultController({
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm
  });
}

export class ReadableStreamBYOBReader
  implements domTypes.ReadableStreamBYOBReader {
  readIntoRequests: { promise: domTypes.Defer<any>; forAuthorCode: boolean }[];

  closedPromise: domTypes.Defer<void>;
  ownerReadableStream: ReadableStream;

  constructor(stream: ReadableStream) {
    if (!IsReadableStream(stream)) {
      throw new TypeError();
    }
    if (!IsReadableByteStreamController(stream.readableStreamController)) {
      throw new TypeError();
    }
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError();
    }
    // ReadableStreamReaderGenericInitialize(this, stream);
    this.ownerReadableStream = stream;
    stream.reader = this;
    if (stream.state === "readable") {
      this.closedPromise = defer();
    } else if (stream.state === "closed") {
      this.closedPromise = defer();
      this.closedPromise.resolve(void 0);
    } else {
      Assert(stream.state === "errored");
      this.closedPromise = defer();
      this.closedPromise.reject(stream.storedError);
    }
    this.readIntoRequests = [];
  }

  get closed(): Promise<void> {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(new TypeError());
    }
    return this.closedPromise;
  }
  cancel(reason?: any): Promise<void> {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    return ReadableStreamReaderGenericCancel(this, reason);
  }

  async read<T extends ArrayBufferView>(
    view: T
  ): Promise<domTypes.ReadableStreamReadResult<T>> {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    if (typeof view !== "object") {
      return Promise.reject(new TypeError());
    }
    if (!isArrayBufferView(view)) {
      throw new TypeError("view is not ArrayBufferView: " + view);
    }
    return ReadableStreamBYOBReaderRead(this, view, true);
  }

  async releaseLock(): Promise<void> {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(new TypeError());
    }
    if (this.ownerReadableStream === void 0) {
      return Promise.reject(new TypeError());
    }
    if (this.readIntoRequests.length > 0) {
      throw new TypeError();
    }
    ReadableStreamReaderGenericRelease(this);
  }
}

export function IsReadableStreamBYOBReader(a: any): a is ReadableStreamBYOBReader {
  return typeof a === "object" && a.hasOwnProperty("readIntoRequests");
}

export function ReadableStreamBYOBReaderRead(
  reader: ReadableStreamBYOBReader,
  view: ArrayBufferView,
  forAuthorCode?: boolean
) {
  if (forAuthorCode === void 0) {
    forAuthorCode = false;
  }
  const stream = reader.ownerReadableStream;
  Assert(stream !== void 0);
  stream.disturbed = true;
  if (stream.state === "errored") {
    return Promise.reject(stream.storedError);
  }
  Assert(stream.state === "readable");
  return ReadableByteStreamControllerPullInto(
    stream.readableStreamController as ReadableByteStreamController,
    view,
    forAuthorCode
  );
}

export class ReadableByteStreamController extends ReadableStreamControllerBase
  implements domTypes.ReadableStreamController<ArrayBufferView> {
  constructor() {
    super();
    throw new TypeError();
  }

  controlledReadableByteStream: ReadableStream;
  _byobRequest: ReadableStreamBYOBRequestImpl;
  get byobRequest(): domTypes.ReadableStreamBYOBRequest {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError();
    }
    if (this._byobRequest === void 0 && this.pendingPullIntos.length > 0) {
      const firstDescriptor = this.pendingPullIntos[0];
      const { buffer, byteOffset, bytesFilled, byteLength } = firstDescriptor;
      const view = new Uint8Array(
        buffer,
        byteOffset + bytesFilled,
        byteLength - bytesFilled
      );
      const byobRequest = Object.create(
        ReadableStreamBYOBRequestImpl.prototype
      );
      SetUpReadableStreamBYOBRequest(byobRequest, this, view);
      this._byobRequest = byobRequest;
    }
    return this._byobRequest;
  }

  get desiredSize(): number |null{
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError();
    }
    return ReadableByteStreamControllerGetDesiredSize(this);
  }

  close(): void {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError();
    }
    if (this.closeRequested) {
      throw new TypeError();
    }
    if (this.controlledReadableByteStream.state !== "readable") {
      throw new TypeError();
    }
    ReadableByteStreamControllerClose(this);
  }

  enqueue(chunk: ArrayBufferView): void {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError();
    }
    if (this.closeRequested) {
      throw new TypeError();
    }
    if (this.controlledReadableByteStream.state !== "readable") {
      throw new TypeError();
    }
    if (typeof chunk !== "object") {
      throw new TypeError();
    }
    if (!isArrayBufferView(chunk)) {
      throw new TypeError("chunk is not ArrayBufferView: " + chunk);
    }
    ReadableByteStreamControllerEnqueue(this, chunk);
  }

  error(e): void {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError();
    }
    ReadableByteStreamControllerError(this, e);
  }

  CancelSteps(reason): Promise<any> {
    ResetQueue(this);
    const result = this.cancelAlgorithm(reason);
    ReadableByteStreamControllerClearAlgorithms(this);
    return result;
  }

  PullSteps(
    forAuthorCode?: boolean
  ): Promise<domTypes.ReadableStreamReadResult<ArrayBufferView>> {
    const stream = this.controlledReadableByteStream;
    Assert(ReadableStreamHasDefaultReader(stream));
    if (this.queueTotalSize > 0) {
      Assert(ReadableStreamGetNumReadRequests(stream) === 0);
      const entry = this.queue.shift();
      this.queueTotalSize -= entry.byteLength;
      ReadableByteStreamControllerHandleQueueDrain(this);
      const view = new Uint8Array(
        entry.buffer,
        entry.byteOffset,
        entry.byteLength
      );
      return Promise.resolve(
        ReadableStreamCreateReadResult(view, false, forAuthorCode)
      );
    }
    const { autoAllocateChunkSize } = this;
    if (autoAllocateChunkSize !== void 0) {
      let buffer: ArrayBuffer;
      try {
        buffer = new ArrayBuffer(autoAllocateChunkSize);
      } catch (e) {
        return Promise.reject(e);
      }
      const pullIntoDescriptor: PullIntoDescriptor = {
        buffer,
        byteOffset: 0,
        byteLength: autoAllocateChunkSize,
        bytesFilled: 0,
        elementSize: 1,
        ctor: Uint8Array,
        readerType: "default"
      };
      this.pendingPullIntos.push(pullIntoDescriptor);
    }
    const promise = ReadableStreamAddReadRequest(stream, forAuthorCode);
    ReadableByteStreamControllerCallPullIfNeeded(this);
    return promise;
  }
}

export function IsReadableByteStreamController(
  x
): x is ReadableByteStreamController {
  return (
    typeof x === "object" && x.hasOwnProperty("controlledReadableByteStream")
  );
}

export function ReadableByteStreamControllerCallPullIfNeeded(
  controller: ReadableByteStreamController
) {
  const shouldPull = ReadableByteStreamControllerShouldCallPull(controller);
  if (!shouldPull) {
    return;
  }
  if (controller.pulling) {
    controller.pullAgain = true;
    return;
  }
  Assert(!controller.pullAgain);
  controller.pulling = true;
  controller
    .pullAlgorithm()
    .then(() => {
      controller.pulling = false;
      if (controller.pullAgain) {
        controller.pullAgain = false;
        ReadableByteStreamControllerCallPullIfNeeded(controller);
      }
    })
    .catch(r => {
      ReadableByteStreamControllerError(controller, r);
    });
}

export function ReadableByteStreamControllerClearAlgorithms(
  controller: ReadableByteStreamController
) {
  controller.pullAlgorithm = void 0;
  controller.cancelAlgorithm = void 0;
}

export function ReadableByteStreamControllerClearPendingPullIntos(
  controller: ReadableByteStreamController
) {
  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  controller.pendingPullIntos = [];
}

export function ReadableByteStreamControllerClose(
  controller: ReadableByteStreamController
) {
  const stream = controller.controlledReadableByteStream;
  Assert(controller.closeRequested === false);
  Assert(stream.state === "readable");
  if (controller.queueTotalSize > 0) {
    controller.closeRequested = true;
    return;
  }
  if (controller.pendingPullIntos.length > 0) {
    const firstPengingPullInfo = controller.pendingPullIntos[0];
    if (firstPengingPullInfo.bytesFilled > 0) {
      const e = new TypeError();
      ReadableByteStreamControllerError(controller, e);
      throw e;
    }
  }
  ReadableByteStreamControllerClearAlgorithms(controller);
  ReadableStreamClose(stream);
}

export function ReadableByteStreamControllerCommitPullIntoDescriptor(
  stream: ReadableStream,
  pullIntoDescriptor: PullIntoDescriptor
) {
  Assert(stream.state !== "errored");
  let done = false;
  if (stream.state === "closed") {
    Assert(pullIntoDescriptor.bytesFilled === 0);
    done = true;
  }
  const filledView = ReadableByteStreamControllerConvertPullIntoDescriptor(
    pullIntoDescriptor
  );
  if (pullIntoDescriptor.readerType === "default") {
    ReadableStreamFulfillReadRequest(stream, filledView, done);
  } else {
    Assert(pullIntoDescriptor.readerType === "byob");
    ReadableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

export function ReadableByteStreamControllerConvertPullIntoDescriptor(
  pullIntoDescriptor: PullIntoDescriptor
) {
  const { bytesFilled, elementSize } = pullIntoDescriptor;
  Assert(bytesFilled <= pullIntoDescriptor.byteLength);
  Assert(bytesFilled % pullIntoDescriptor.elementSize === 0);
  return new pullIntoDescriptor.ctor(
    pullIntoDescriptor.buffer,
    pullIntoDescriptor.byteOffset,
    bytesFilled / elementSize
  );
}

export function ReadableByteStreamControllerEnqueue(
  controller: ReadableByteStreamController,
  chunk: ArrayBufferView
) {
  const stream = controller.controlledReadableByteStream;
  Assert(controller.closeRequested === false);
  Assert(stream.state === "readable");
  const { buffer } = chunk;
  const { byteOffset, byteLength } = chunk;
  const transferredBuffer = TransferArrayBuffer(buffer);
  if (ReadableStreamHasDefaultReader(stream)) {
    if (ReadableStreamGetNumReadRequests(stream) === 0) {
      ReadableByteStreamControllerEnqueueChunkToQueue(
        controller,
        transferredBuffer,
        byteOffset,
        byteLength
      );
    } else {
      Assert(controller.queue.length === 0, "l=0");
      const transferredView = new Uint8Array(
        transferredBuffer,
        byteOffset,
        byteLength
      );
      ReadableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else if (ReadableStreamHasBYOBReader(stream)) {
    ReadableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength
    );
    ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
      controller
    );
  } else {
    Assert(
      IsReadableStreamLocked(stream) === false,
      "stream should not be locked"
    );
    ReadableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength
    );
  }
  ReadableByteStreamControllerCallPullIfNeeded(controller);
}

export function ReadableByteStreamControllerEnqueueChunkToQueue(
  controller: ReadableByteStreamController,
  buffer: ArrayBuffer,
  byteOffset: number,
  byteLength: number
) {
  controller.queue.push({
    buffer,
    byteOffset,
    byteLength
  });
  controller.queueTotalSize += byteLength;
}

export function ReadableByteStreamControllerError(
  controller: ReadableByteStreamController,
  e
) {
  const stream = controller.controlledReadableByteStream;
  if (stream.state !== "readable") {
    return;
  }
  ReadableByteStreamControllerClearPendingPullIntos(controller);
  ResetQueue(controller);
  ReadableByteStreamControllerClearAlgorithms(controller);
  ReadableStreamError(controller.controlledReadableByteStream, e);
}

export function ReadableByteStreamControllerFillHeadPullIntoDescriptor(
  controller: ReadableByteStreamController,
  size: number,
  pullIntoDescriptor: PullIntoDescriptor
) {
  Assert(
    controller.pendingPullIntos.length === 0 ||
      controller.pendingPullIntos[0] === pullIntoDescriptor
  );
  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  pullIntoDescriptor.bytesFilled += size;
}

export function ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(
  controller: ReadableByteStreamController,
  pullIntoDescriptor: PullIntoDescriptor
): boolean {
  const { elementSize } = pullIntoDescriptor;
  const currentAlignedBytes =
    pullIntoDescriptor.bytesFilled -
    (pullIntoDescriptor.bytesFilled % elementSize);
  const maxBytesToCopy = Math.min(
    controller.queueTotalSize,
    pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled
  );
  const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
  const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % elementSize);
  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  if (maxAlignedBytes > currentAlignedBytes) {
    totalBytesToCopyRemaining =
      maxAlignedBytes - pullIntoDescriptor.bytesFilled;
    ready = true;
  }
  const { queue } = controller;
  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];
    const bytesToCopy = Math.min(
      totalBytesToCopyRemaining,
      headOfQueue.byteLength
    );
    const destStart =
      pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const srcView = new Uint8Array(
      headOfQueue.buffer,
      headOfQueue.byteOffset,
      headOfQueue.byteLength
    );
    const destView = new Uint8Array(
      pullIntoDescriptor.buffer,
      destStart,
      bytesToCopy
    );
    for (let i = 0; i < bytesToCopy; i++) {
      destView[i] = srcView[i];
    }
    if (headOfQueue.byteLength === bytesToCopy) {
      queue.shift();
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller.queueTotalSize -= bytesToCopy;
    ReadableByteStreamControllerFillHeadPullIntoDescriptor(
      controller,
      bytesToCopy,
      pullIntoDescriptor
    );
    totalBytesToCopyRemaining -= bytesToCopy;
  }
  if (ready === false) {
    Assert(controller.queueTotalSize === 0);
    Assert(pullIntoDescriptor.bytesFilled > 0);
    Assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }
  return ready;
}

export function ReadableByteStreamControllerGetDesiredSize(
  controller: ReadableByteStreamController
): number | null {
  const stream = controller.controlledReadableByteStream;
  const { state } = stream;
  if (state === "errored") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return controller.strategyHWM - controller.queueTotalSize;
}

export function ReadableByteStreamControllerHandleQueueDrain(
  controller: ReadableByteStreamController
) {
  Assert(controller.controlledReadableByteStream.state === "readable");
  if (controller.queueTotalSize === 0 && controller.closeRequested) {
    ReadableByteStreamControllerClearAlgorithms(controller);
    ReadableStreamClose(controller.controlledReadableByteStream);
  } else {
    ReadableByteStreamControllerCallPullIfNeeded(controller);
  }
}

export function ReadableByteStreamControllerInvalidateBYOBRequest(
  controller: ReadableByteStreamController
) {
  if (controller._byobRequest === void 0) {
    return;
  }
  controller._byobRequest.associatedReadableByteStreamController = void 0;
  controller._byobRequest._view = void 0;
  controller._byobRequest = void 0;
}

export function ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
  controller: ReadableByteStreamController
) {
  Assert(controller.closeRequested === false);
  while (controller.pendingPullIntos.length > 0) {
    if (controller.queueTotalSize === 0) {
      return;
    }
    const pullIntoDescriptor = controller.pendingPullIntos[0];
    if (
      ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(
        controller,
        pullIntoDescriptor
      ) === true
    ) {
      ReadableByteStreamControllerShiftPendingPullInto(controller);
      ReadableByteStreamControllerCommitPullIntoDescriptor(
        controller.controlledReadableByteStream,
        pullIntoDescriptor
      );
    }
  }
}

const TypedArraySizeMap: { [key: string]: [number, any] } = {
  Int8Array: [1, Int8Array],
  Uint8Array: [1, Uint8Array],
  Uint8ClampedArray: [1, Uint8ClampedArray],
  Int16Array: [2, Int16Array],
  Uint16Array: [2, Uint16Array],
  Int32Array: [4, Int32Array],
  Uint32Array: [4, Uint32Array],
  Float32Array: [4, Float32Array],
  Float64Array: [8, Float64Array]
};

export function ReadableByteStreamControllerPullInto(
  controller: ReadableByteStreamController,
  view: ArrayBufferView,
  forAuthorCode: boolean
): Promise<any> {
  const stream = controller.controlledReadableByteStream;
  let elementSize = 1;
  let ctor = DataView;
  const ctorName = view.constructor.name;
  if (TypedArraySizeMap[ctorName]) {
    [elementSize, ctor] = TypedArraySizeMap[ctorName];
  }
  const { byteOffset, byteLength } = view;
  const buffer = TransferArrayBuffer(view.buffer);
  const pullIntoDescriptor: PullIntoDescriptor = {
    buffer,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    elementSize,
    ctor,
    readerType: "byob"
  };
  if (controller.pendingPullIntos.length > 0) {
    controller.pendingPullIntos.push(pullIntoDescriptor);
    return ReadableStreamAddReadIntoRequest(stream, forAuthorCode);
  }
  if (stream.state === "closed") {
    const emptyView = new ctor(
      pullIntoDescriptor.buffer,
      pullIntoDescriptor.byteOffset,
      0
    );
    return Promise.resolve(
      ReadableStreamCreateReadResult(emptyView, true, forAuthorCode)
    );
  }
  if (controller.queueTotalSize > 0) {
    if (
      ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(
        controller,
        pullIntoDescriptor
      )
    ) {
      const filedView = ReadableByteStreamControllerConvertPullIntoDescriptor(
        pullIntoDescriptor
      );
      ReadableByteStreamControllerHandleQueueDrain(controller);
      return Promise.resolve(
        ReadableStreamCreateReadResult(filedView, false, forAuthorCode)
      );
    }
    if (controller.closeRequested) {
      const e = new TypeError();
      ReadableByteStreamControllerError(controller, e);
      return Promise.reject(e);
    }
  }
  controller.pendingPullIntos.push(pullIntoDescriptor);
  const promise = ReadableStreamAddReadIntoRequest(stream, forAuthorCode);
  ReadableByteStreamControllerCallPullIfNeeded(controller);
  return promise;
}

export function ReadableByteStreamControllerRespond(
  controller: ReadableByteStreamController,
  bytesWritten: number
): void {
  if (IsFiniteNonNegativeNumber(bytesWritten) === false) {
    throw new RangeError();
  }
  Assert(controller.pendingPullIntos.length > 0);
  ReadableByteStreamControllerRespondInternal(controller, bytesWritten);
}

export function ReadableByteStreamControllerRespondInClosedState(
  controller: ReadableByteStreamController,
  firstDescriptor: PullIntoDescriptor
) {
  firstDescriptor.buffer = TransferArrayBuffer(firstDescriptor.buffer);
  Assert(firstDescriptor.bytesFilled === 0);
  const stream = controller.controlledReadableByteStream;
  if (ReadableStreamHasBYOBReader(stream)) {
    while (ReadableStreamGetNumReadIntoRequests(stream) > 0) {
      const pullIntoDescriptor = ReadableByteStreamControllerShiftPendingPullInto(
        controller
      );
      ReadableByteStreamControllerCommitPullIntoDescriptor(
        stream,
        pullIntoDescriptor
      );
    }
  }
}

export function ReadableByteStreamControllerRespondInReadableState(
  controller: ReadableByteStreamController,
  bytesWritten: number,
  pullIntoDescriptor: PullIntoDescriptor
) {
  if (
    pullIntoDescriptor.bytesFilled + bytesWritten >
    pullIntoDescriptor.byteLength
  ) {
    throw new RangeError();
  }
  ReadableByteStreamControllerFillHeadPullIntoDescriptor(
    controller,
    bytesWritten,
    pullIntoDescriptor
  );
  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    return;
  }
  ReadableByteStreamControllerShiftPendingPullInto(controller);
  const remainderSize =
    pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = CloneArrayBuffer(
      pullIntoDescriptor.buffer,
      end - remainderSize,
      remainderSize
    );
    ReadableByteStreamControllerEnqueueChunkToQueue(
      controller,
      remainder,
      0,
      remainder.byteLength
    );
  }
  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  pullIntoDescriptor.bytesFilled =
    pullIntoDescriptor.bytesFilled - remainderSize;
  ReadableByteStreamControllerCommitPullIntoDescriptor(
    controller.controlledReadableByteStream,
    pullIntoDescriptor
  );
  ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
}

function CloneArrayBuffer(
  srcBuffer: ArrayBuffer,
  srcByteOffset: number,
  srcLength: number
): ArrayBuffer {
  const ret = new ArrayBuffer(srcLength);
  const retView = new DataView(ret);
  const srcView = new DataView(srcBuffer, srcByteOffset, srcLength);
  for (let i = 0; i < srcLength; i++) {
    retView[i] = srcView[i];
  }
  return ret;
}

export function ReadableByteStreamControllerRespondInternal(
  controller: ReadableByteStreamController,
  bytesWritten: number
) {
  const firstDescriptor = controller.pendingPullIntos[0];
  const stream = controller.controlledReadableByteStream;
  if (stream.state === "closed") {
    if (bytesWritten !== 0) {
      throw new TypeError();
    }
    ReadableByteStreamControllerRespondInClosedState(
      controller,
      firstDescriptor
    );
  } else {
    Assert(stream.state === "readable");
    ReadableByteStreamControllerRespondInReadableState(
      controller,
      bytesWritten,
      firstDescriptor
    );
  }
  ReadableByteStreamControllerCallPullIfNeeded(controller);
}

export function ReadableByteStreamControllerRespondWithNewView(
  controller: ReadableByteStreamController,
  view
) {
  Assert(controller.pendingPullIntos.length > 0);
  const firstDescriptor = controller.pendingPullIntos[0];
  if (
    firstDescriptor.byteOffset + firstDescriptor.bytesFilled !==
    view.ByteOffset
  ) {
    throw new RangeError();
  }
  if (firstDescriptor.byteLength !== view.ByteLength) {
    throw new RangeError();
  }
  firstDescriptor.buffer = view.ViewedArrayBuffer;
  ReadableByteStreamControllerRespondInternal(controller, view.ByteLength);
}

export function ReadableByteStreamControllerShiftPendingPullInto(
  controller: ReadableByteStreamController
): PullIntoDescriptor {
  const descriptor = controller.pendingPullIntos.shift();
  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  return descriptor;
}

export function ReadableByteStreamControllerShouldCallPull(
  controller: ReadableByteStreamController
) {
  const stream = controller.controlledReadableByteStream;
  if (stream.state !== "readable") {
    return false;
  }
  if (controller.closeRequested === true) {
    return false;
  }
  if (controller.started === false) {
    return false;
  }
  if (
    ReadableStreamHasDefaultReader(stream) &&
    ReadableStreamGetNumReadRequests(stream) > 0
  ) {
    return true;
  }
  if (
    ReadableStreamHasBYOBReader(stream) &&
    ReadableStreamGetNumReadIntoRequests(stream) > 0
  ) {
    return true;
  }
  const desiredSize = ReadableByteStreamControllerGetDesiredSize(controller);
  Assert(desiredSize !== null);
  if (desiredSize > 0) {
    return true;
  }
  return false;
}

export function SetUpReadableByteStreamController(
  stream: ReadableStream,
  controller: ReadableByteStreamController,
  startAlgorithm: domTypes.StartAlgorithm,
  pullAlgorithm: domTypes.PullAlgorithm,
  cancelAlgorithm: domTypes.CancelAlgorithm,
  highWaterMark: number,
  autoAllocateChunkSize?: number
) {
  Assert(stream.readableStreamController === void 0);
  if (autoAllocateChunkSize !== void 0) {
    Assert(Number.isInteger(autoAllocateChunkSize));
    Assert(autoAllocateChunkSize > 0);
  }
  controller.controlledReadableByteStream = stream;
  controller.pullAgain = false;
  controller.pulling = false;
  ReadableByteStreamControllerClearPendingPullIntos(controller);
  ResetQueue(controller);
  controller.closeRequested = false;
  controller.started = false;
  controller.strategyHWM = ValidateAndNormalizeHighWaterMark(highWaterMark);
  controller.pullAlgorithm = pullAlgorithm;
  controller.cancelAlgorithm = cancelAlgorithm;
  controller.autoAllocateChunkSize = autoAllocateChunkSize;
  controller.pendingPullIntos = [];
  stream.readableStreamController = controller;
  Promise.resolve(startAlgorithm())
    .then(() => {
      controller.started = true;
      Assert(!controller.pulling);
      Assert(!controller.pullAgain);
      ReadableByteStreamControllerCallPullIfNeeded(controller);
    })
    .catch(r => {
      ReadableByteStreamControllerError(controller, r);
    });
}

export function SetUpReadableByteStreamControllerFromUnderlyingSource<T>(
  stream: ReadableStream,
  underlyingByteSource: domTypes.UnderlyingSource,
  highWaterMark: number
) {
  Assert(underlyingByteSource !== void 0);
  const controller = Object.create(ReadableByteStreamController.prototype);
  const startAlgorithm = () =>
    InvokeOrNoop(underlyingByteSource, "start", controller);
  const pullAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingByteSource,
    "pull",
    0,
    controller
  );
  const cancelAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingByteSource,
    "cancel",
    1
  );
  const { autoAllocateChunkSize } = underlyingByteSource;
  if (autoAllocateChunkSize !== void 0) {
    if (!Number.isInteger(autoAllocateChunkSize) || autoAllocateChunkSize < 0) {
      throw new RangeError();
    }
  }
  SetUpReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize
  );
}
