import { defer } from "../defer";
import {
  IsNonNegativeNumber,
  MakeSizeAlgorithmFromSizeFunction,
  ValidateAndNormalizeHighWaterMark,
  ResetQueue
} from "./misc";
import { Assert } from "./misc";
import * as domTypes from "../dom_types";

export class WritableStream<T = any> {
  backpressure;
  closeRequest?: domTypes.Defer<any>;
  inFlightWriteRequest?: domTypes.Defer<any>;
  inFlightCloseRequest?: domTypes.Defer<any>;
  pendingAbortRequest?: {
    promise: domTypes.Defer<any>;
    reason?: any;
    wasAlreadyErroring: boolean;
  };
  state?: "writable" | "closed" | "erroring" | "errored";
  storedError?: Error;
  writableStreamController?: domTypes.WritableStreamDefaultController<T>;
  writer?: domTypes.WritableStreamDefaultWriter<T>;
  writeRequests?: domTypes.Defer<any>[];
  constructor(
    underlyingSink: domTypes.UnderlyingSink<T>,
    strategy: domTypes.QueuingStrategy = {}
  ) {
    InitializeWritableStream(this);
    let { size, highWaterMark } = strategy;
    const { type } = underlyingSink;
    if (type !== void 0) {
      throw new RangeError("type should not be specified yet");
    }
    const sizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(size);
    if (highWaterMark === void 0) {
      highWaterMark = 1;
    }
    highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);
    SetUpWritableStreamDefaultControllerFromUnderlyingSink(
      this,
      underlyingSink,
      highWaterMark,
      sizeAlgorithm
    );
  }

  get locked() {
    if (!IsWritableStream(this)) {
      throw new TypeError("this is not writable stream");
    }
    return IsWritableStreamLocked(this);
  }

  async abort(reason) {
    if (!IsWritableStream(this)) {
      throw new TypeError("this is not writable stream");
    }
    if (IsWritableStreamLocked(this)) {
      throw new TypeError("stream locked");
    }
    return WritableStreamAbort(this, reason);
  }

  getWriter(): domTypes.WritableStreamWriter<T> {
    if (!IsWritableStream(this)) {
      throw new TypeError("this is not writable stream");
    }
    return AcquireWritableStreamDefaultWriter(this);
  }
}

export function AcquireWritableStreamDefaultWriter<T>(
  stream: domTypes.WritableStream
): domTypes.WritableStreamDefaultWriter<T> {
  return new WritableStreamDefaultWriter(stream);
}

export function CreateWritableStream<T>(
  startAlgorithm: domTypes.StartAlgorithm,
  writeAlgorithm: domTypes.WriteAlgorithm<T>,
  closeAlgorithm: domTypes.CloseAlgorithm,
  abortAlgorithm: domTypes.AbortAlgorithm,
  highWaterMark: number = 1,
  sizeAlgorithm: domTypes.SizeAlgorithm = () => 1
) {
  Assert(IsNonNegativeNumber(highWaterMark));
  const stream = Object.create(WritableStream.prototype);
  InitializeWritableStream(stream);
  const controller = createWritableStreamDefaultController();
  SetUpWritableStreamDefaultController({
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm
  });
}

export function InitializeWritableStream(stream: WritableStream) {
  stream.state = "writable";
  stream.storedError = void 0;
  stream.writer = void 0;
  stream.writableStreamController = void 0;
  stream.inFlightCloseRequest = void 0;
  stream.closeRequest = void 0;
  stream.pendingAbortRequest = void 0;
  stream.writeRequests = [];
  stream.backpressure = false;
}

export function IsWritableStream(x): x is WritableStream {
  return typeof x === "object" && x.hasOwnProperty("writableStreamController");
}

export function IsWritableStreamLocked(stream: WritableStream) {
  Assert(IsWritableStream(stream));
  return stream.writer !== void 0;
}

export async function WritableStreamAbort(
  stream: WritableStream,
  reason
): Promise<any> {
  const { state } = stream;
  if (state === "closed" || state === "errored") {
    return void 0;
  }
  if (stream.pendingAbortRequest !== void 0) {
    return stream.pendingAbortRequest.promise;
  }
  Assert(stream.state === "writable" || stream.state === "erroring");
  let wasAlreadyErroring = false;
  if (state === "erroring") {
    wasAlreadyErroring = true;
    reason = void 0;
  }
  const promise = defer();
  stream.pendingAbortRequest = {
    promise,
    reason,
    wasAlreadyErroring
  };
  if (!wasAlreadyErroring) {
    WritableStreamStartErroring(stream, reason);
  }
  return promise;
}

export function WritableStreamAddWriteRequest(
  stream: WritableStream
): Promise<void> {
  Assert(IsWritableStreamLocked(stream));
  Assert(stream.state === "writable");
  const promise = defer<void>();
  stream.writeRequests.push(promise);
  return promise;
}

export function WritableStreamDealWithRejection(stream: WritableStream, error) {
  const { state } = stream;
  if (state === "writable") {
    WritableStreamStartErroring(stream, error);
    return;
  }
  Assert(state === "erroring");
  WritableStreamFinishErroring(stream);
}

export function WritableStreamStartErroring(stream: WritableStream, reason) {
  Assert(stream.storedError === void 0);
  Assert(stream.state === "writable");
  const controller = stream.writableStreamController;
  Assert(controller !== void 0);
  stream.state = "erroring";
  stream.storedError = reason;
  const { writer } = stream;
  if (writer !== void 0) {
    WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);
  }
  if (!WritableStreamHasOperationMarkedInFlight(stream) && controller.started) {
    WritableStreamFinishErroring(stream);
  }
}

export function WritableStreamFinishErroring(stream: WritableStream) {
  Assert(stream.state === "erroring");
  Assert(!WritableStreamHasOperationMarkedInFlight(stream));
  stream.state = "errored";
  stream.writableStreamController[ErrorSteps]();
  const { storedError } = stream;
  stream.writeRequests.forEach(p => p.reject(storedError));
  stream.writeRequests = [];
  if (stream.pendingAbortRequest === void 0) {
    WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  const abortRequest = stream.pendingAbortRequest;
  stream.pendingAbortRequest = void 0;
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.promise.reject(storedError);
    WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  const promise = stream.writableStreamController[AbortSteps](
    abortRequest.reason
  );
  promise
    .then(() => {
      abortRequest.promise.resolve(void 0);
      WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    })
    .catch(r => {
      abortRequest.promise.reject(r);
      WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    });
}

export function WritableStreamFinishInFlightWrite(stream: WritableStream) {
  Assert(stream.inFlightWriteRequest !== void 0);
  stream.inFlightWriteRequest.resolve(void 0);
  stream.inFlightWriteRequest = void 0;
}

export function WritableStreamFinishInFlightWriteWithError(
  stream: WritableStream,
  error
) {
  Assert(stream.inFlightWriteRequest !== void 0);
  stream.inFlightWriteRequest.resolve(void 0);
  stream.inFlightWriteRequest = void 0;
  Assert(stream.state === "writable" || stream.state === "erroring");
  WritableStreamDealWithRejection(stream, error);
}

export function WritableStreamFinishInFlightClose(stream: WritableStream) {
  Assert(stream.inFlightCloseRequest !== void 0);
  stream.inFlightCloseRequest.resolve(void 0);
  stream.inFlightCloseRequest = void 0;
  const { state } = stream;
  Assert(stream.state === "writable" || stream.state === "erroring");
  if (state === "erroring") {
    stream.storedError = void 0;
    if (stream.pendingAbortRequest !== void 0) {
      stream.pendingAbortRequest.promise.resolve(void 0);
      stream.pendingAbortRequest = void 0;
    }
  }
  stream.state = "closed";
  const { writer } = stream;
  if (writer !== void 0) {
    writer.closedPromise.resolve(void 0);
  }
  Assert(stream.pendingAbortRequest === void 0);
  Assert(stream.storedError === void 0);
}

export function WritableStreamFinishInFlightCloseWithError(
  stream: WritableStream,
  error
) {
  Assert(stream.inFlightCloseRequest !== void 0);
  stream.inFlightCloseRequest.resolve(void 0);
  stream.inFlightCloseRequest = void 0;
  Assert(stream.state === "writable" || stream.state === "erroring");
  if (stream.pendingAbortRequest !== void 0) {
    stream.pendingAbortRequest.promise.reject(error);
    stream.pendingAbortRequest = void 0;
  }
  WritableStreamDealWithRejection(stream, error);
}

export function WritableStreamCloseQueuedOrInFlight(stream: WritableStream) {
  return !(
    stream.closeRequest === void 0 || stream.inFlightCloseRequest === void 0
  );
}

export function WritableStreamHasOperationMarkedInFlight(
  stream: WritableStream
) {
  return !(
    stream.inFlightWriteRequest === void 0 &&
    stream.inFlightCloseRequest === void 0
  );
}

export function WritableStreamMarkCloseRequestInFlight(stream: WritableStream) {
  Assert(stream.inFlightCloseRequest === void 0);
  Assert(stream.closeRequest !== void 0);
  stream.inFlightCloseRequest = stream.closeRequest;
  stream.closeRequest = void 0;
}

export function WritableStreamMarkFirstWriteRequestInFlight(
  stream: WritableStream
) {
  Assert(stream.inFlightWriteRequest === void 0);
  Assert(stream.writeRequests.length > 0);
  const writerRequest = stream.writeRequests.shift();
  stream.inFlightWriteRequest = writerRequest;
}

export function WritableStreamRejectCloseAndClosedPromiseIfNeeded(
  stream: WritableStream
) {
  Assert(stream.state === "errored");
  if (stream.pendingAbortRequest !== void 0) {
    Assert(stream.inFlightCloseRequest !== void 0);
    stream.closeRequest.reject(stream.storedError);
    stream.closeRequest = void 0;
  }
  const { writer } = stream;
  if (writer !== void 0) {
    writer.closedPromise.reject(stream.storedError);
  }
}

export function WritableStreamUpdateBackpressure(
  stream: WritableStream,
  backpressure: boolean
) {
  Assert(stream.state === "writable");
  Assert(!WritableStreamCloseQueuedOrInFlight(stream));
  const { writer } = stream;
  if (writer !== void 0 && backpressure !== stream.backpressure) {
    if (backpressure) {
      writer.readyPromise = defer();
    } else {
      Assert(!backpressure);
      writer.readyPromise.resolve(void 0);
    }
  }
  stream.backpressure = backpressure;
}

export class WritableStreamDefaultWriter<T>
  implements domTypes.WritableStreamWriter<T> {
  constructor(stream: WritableStream) {
    if (!IsWritableStream(stream)) {
      throw new TypeError("stream is not writable stream");
    }
    if (IsWritableStreamLocked(stream)) {
      throw new TypeError("stream is locked");
    }
    this.ownerWritableStream = stream;
    stream.writer = this;
    const { state } = stream;
    if (state === "writable") {
      if (!WritableStreamCloseQueuedOrInFlight(stream) && stream.backpressure) {
        this.readyPromise = defer();
      } else {
        this.readyPromise = resolveDefer(void 0);
      }
      this.closedPromise = defer();
    } else if (state === "erroring") {
      this.readyPromise = rejectDefer(stream.storedError);
      this.closedPromise = defer();
    } else if (state === "closed") {
      this.readyPromise = resolveDefer(void 0);
      this.closedPromise = resolveDefer(void 0);
    } else {
      Assert(state === "errored");
      const { storedError } = stream;
      this.readyPromise = rejectDefer(storedError);
      this.closedPromise = rejectDefer(storedError);
    }
  }

  get closed(): Promise<void> {
    if (!IsWritableStreamDefaultWriter(this)) {
      return Promise.reject(
        new TypeError("this is not WritableStreamDefaultWriter")
      );
    }
    return this.closedPromise;
  }

  get desiredSize(): number {
    if (!IsWritableStreamDefaultWriter(this)) {
      throw new TypeError("this is not WritableStreamDefaultWriter");
    }
    if (this.ownerWritableStream === void 0) {
      throw new TypeError("stream is undefined");
    }
    return WritableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): Promise<undefined> {
    if (!IsWritableStreamDefaultWriter(this)) {
      return Promise.reject(
        new TypeError("this is not WritableStreamDefaultWriter")
      );
    }
    return this.readyPromise;
  }

  async abort(reason?: any): Promise<void> {
    if (!IsWritableStreamDefaultWriter(this)) {
      throw new TypeError("this is not WritableStreamDefaultWriter");
    }
    if (this.ownerWritableStream === void 0) {
      throw new TypeError("stream is undefined");
    }
    return WritableStreamDefaultWriterAbort(this, reason);
  }

  async close(): Promise<void> {
    if (!IsWritableStreamDefaultWriter(this)) {
      throw new TypeError();
    }
    const stream = this.ownerWritableStream;
    if (stream === void 0) {
      throw new TypeError();
    }
    if (WritableStreamCloseQueuedOrInFlight(stream)) {
      throw new TypeError();
    }
    return WritableStreamDefaultWriterClose(this);
  }

  releaseLock() {
    if (!IsWritableStreamDefaultWriter(this)) {
      throw new TypeError();
    }
    const stream = this.ownerWritableStream;
    if (stream === void 0) {
      throw new TypeError();
    }
    Assert(stream.writer !== void 0);
    WritableStreamDefaultWriterRelease(this);
  }

  write(chunk: T): Promise<void> {
    if (!IsWritableStreamDefaultWriter(this)) {
      throw new TypeError();
    }
    const stream = this.ownerWritableStream;
    if (stream === void 0) {
      throw new TypeError();
    }
    return WritableStreamDefaultWriterWrite(this, chunk);
  }

  closedPromise: domTypes.Defer<any>;
  ownerWritableStream: WritableStream;
  readyPromise: domTypes.Defer<any>;
}

export function IsWritableStreamDefaultWriter<T>(
  x
): x is WritableStreamDefaultWriter<T> {
  return typeof x === "object" && x.hasOwnProperty("ownerWritableStream");
}

export function WritableStreamDefaultWriterAbort<T>(
  writer: WritableStreamDefaultWriter<T>,
  reason
) {
  Assert(writer.ownerWritableStream !== void 0);
  return WritableStreamAbort(writer.ownerWritableStream, reason);
}

export async function WritableStreamDefaultWriterClose<T>(
  writer: WritableStreamDefaultWriter<T>
): Promise<any> {
  const stream = writer.ownerWritableStream;
  Assert(stream !== void 0);
  const { state } = stream;
  if (state === "closed" || state === "errored") {
    throw new TypeError(`stream is ${state}`);
  }
  Assert(state === "writable" || state === "erroring");
  Assert(!WritableStreamCloseQueuedOrInFlight(stream));
  const promise = defer();
  stream.closeRequest = promise;
  if (stream.backpressure && state == "writable") {
    writer.readyPromise.resolve();
  }
  WritableStreamDefaultControllerClose(stream.writableStreamController);
  return promise;
}

export async function WritableStreamDefaultWriterCloseWithErrorPropagation<T>(
  writer: WritableStreamDefaultWriter<T>
) {
  const stream = writer.ownerWritableStream;
  Assert(stream !== void 0);
  const { state } = stream;
  if (WritableStreamCloseQueuedOrInFlight(stream) || state === "closed") {
    return void 0;
  }
  if (state === "errored") {
    throw stream.storedError;
  }
  Assert(state === "writable" || state === "erroring");
  return WritableStreamDefaultWriterClose(writer);
}

export function WritableStreamDefaultWriterEnsureClosedPromiseRejected<T>(
  writer: WritableStreamDefaultWriter<T>,
  error
) {
  if (writer.closedPromise[domTypes.PromiseState] === "pending") {
    writer.closedPromise.reject(error);
  } else {
    writer.closedPromise = rejectDefer(error);
  }
}

export function WritableStreamDefaultWriterEnsureReadyPromiseRejected<T>(
  writer: WritableStreamDefaultWriter<T>,
  error
) {
  if (writer.readyPromise[domTypes.PromiseState] === "pending") {
    writer.readyPromise.reject(error);
  } else {
    writer.readyPromise = rejectDefer(error);
  }
}

export function WritableStreamDefaultWriterGetDesiredSize<T>(
  writer: WritableStreamDefaultWriter<T>
) {
  const stream = writer.ownerWritableStream;
  const { state } = stream;
  if (state === "errored" || state === "erroring") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return WritableStreamDefaultControllerGetDesiredSize(
    stream.writableStreamController
  );
}

export function WritableStreamDefaultWriterRelease<T>(
  writer: WritableStreamDefaultWriter<T>
) {
  const stream = writer.ownerWritableStream;
  Assert(stream !== void 0, "stream is undefined");
  Assert(stream.writer === writer, "writer is not identical");
  const releasedError = new TypeError();
  WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
  WritableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);
  stream.writer = void 0;
  writer.ownerWritableStream = void 0;
}

export async function WritableStreamDefaultWriterWrite<T>(
  writer: WritableStreamDefaultWriter<T>,
  chunk
): Promise<void> {
  const stream = writer.ownerWritableStream;
  Assert(stream !== void 0);
  const controller = stream.writableStreamController;
  const chunkSize = WritableStreamDefaultControllerGetChunkSize(
    controller,
    chunk
  );
  if (stream !== writer.ownerWritableStream) {
    throw new TypeError("different stream");
  }
  const { state } = stream;
  if (state === "errored") {
    throw stream.storedError;
  }
  if (WritableStreamCloseQueuedOrInFlight(stream) || state === "closed") {
    throw new TypeError(
      `stream is ${state === "closed" ? "closed" : "closing"}`
    );
  }
  if (state === "erroring") {
    throw stream.storedError;
  }
  Assert(state === "writable");
  const promise = WritableStreamAddWriteRequest(stream);
  WritableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}


export const ErrorSteps = Symbol("ErrorSteps");
export const AbortSteps = Symbol("AbortSteps");

export function createWritableStreamDefaultController<
  T
>(): WritableStreamDefaultController<T> {
  const ret = Object.create(WritableStreamDefaultController.prototype);
  ret[ErrorSteps] = () => ResetQueue(ret);
  ret[AbortSteps] = reason => {
    const result = ret.abortAlgorithm(reason);
    WritableStreamDefaultControllerClearAlgorithms(ret);
    return result;
  };
  return ret;
}

export class WritableStreamDefaultController<T>
  implements domTypes.WritableStreamController<T> {
  abortAlgorithm?: domTypes.AbortAlgorithm;
  closeAlgorithm?: domTypes.CloseAlgorithm;
  controlledWritableStream: WritableStream;
  queue: ("close" | { chunk: T })[];
  queueTotalSize: number;
  started: boolean;
  strategyHWM: number;
  strategySizeAlgorithm?: domTypes.SizeAlgorithm;
  writeAlgorithm?: domTypes.WriteAlgorithm<T>;

  constructor() {
    throw new TypeError();
  }

  error(e?: any) {
    if (!IsWritableStreamDefaultController(this)) {
      throw new TypeError("this is not WritableStreamDefaultController");
    }
    const { state } = this.controlledWritableStream;
    if (state !== "writable") {
      return;
    }
    WritableStreamDefaultControllerError(this, e);
  }
}

export function IsWritableStreamDefaultController<T>(
  x: any
): x is WritableStreamDefaultController<T> {
  return typeof x === "object" && x.hasOwnProperty("controlledWritableStream");
}

export function SetUpWritableStreamDefaultController<T>(params: {
  stream: WritableStream;
  controller: WritableStreamDefaultController<T>;
  startAlgorithm: domTypes.StartAlgorithm;
  writeAlgorithm: domTypes.WriteAlgorithm<T>;
  closeAlgorithm: domTypes.CloseAlgorithm;
  abortAlgorithm: domTypes.AbortAlgorithm;
  highWaterMark: number;
  sizeAlgorithm: domTypes.SizeAlgorithm;
}) {
  const {
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm
  } = params;
  Assert(IsWritableStream(stream));
  Assert(stream.writableStreamController === void 0);
  controller.controlledWritableStream = stream;
  stream.writableStreamController = controller;
  ResetQueue(controller);
  controller.started = false;
  controller.strategySizeAlgorithm = sizeAlgorithm;
  controller.strategyHWM = highWaterMark;
  controller.writeAlgorithm = writeAlgorithm;
  controller.closeAlgorithm = closeAlgorithm;
  controller.abortAlgorithm = abortAlgorithm;
  const backpressure = WritableStreamDefaultControllerGetBackpressure(
    controller
  );
  WritableStreamUpdateBackpressure(stream, backpressure);
  Promise.resolve(startAlgorithm())
    .then(() => {
      Assert(stream.state === "writable" || stream.state === "erroring");
      controller.started = true;
      WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    })
    .catch(r => {
      Assert(stream.state === "writable" || stream.state === "erroring");
      controller.started = true;
      WritableStreamDealWithRejection(stream, r);
    });
}

export function SetUpWritableStreamDefaultControllerFromUnderlyingSink(
  stream: WritableStream,
  underlyingSink,
  highWaterMark: number,
  sizeAlgorithm: domTypes.SizeAlgorithm
) {
  Assert(underlyingSink !== void 0);
  const controller = createWritableStreamDefaultController();
  const startAlgorithm = () =>
    InvokeOrNoop(underlyingSink, "start", controller);
  const writeAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingSink,
    "write",
    1,
    controller
  );
  const closeAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingSink,
    "close",
    0
  );
  const abortAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    underlyingSink,
    "abort",
    1
  );
  SetUpWritableStreamDefaultController({
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm
  });
}

export function WritableStreamDefaultControllerClearAlgorithms<T>(
  controller: WritableStreamDefaultController<T>
) {
  controller.writeAlgorithm = void 0;
  controller.closeAlgorithm = void 0;
  controller.abortAlgorithm = void 0;
  controller.strategySizeAlgorithm = void 0;
}

export function WritableStreamDefaultControllerClose<T>(
  controller: WritableStreamDefaultController<T>
) {
  EnqueueValueWithSize(controller, "close", 0);
  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

export function WritableStreamDefaultControllerGetChunkSize<T>(
  controller: WritableStreamDefaultController<T>,
  chunk
): number {
  try {
    return controller.strategySizeAlgorithm(chunk);
  } catch (e) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, e);
    return 1;
  }
}

export function WritableStreamDefaultControllerGetDesiredSize<T>(
  controller: WritableStreamDefaultController<T>
): number {
  return controller.strategyHWM - controller.queueTotalSize;
}

export function WritableStreamDefaultControllerWrite<T>(
  controller: WritableStreamDefaultController<T>,
  chunk,
  chunkSize: number
) {
  const writeRecord = { chunk };
  try {
    EnqueueValueWithSize(controller, writeRecord, chunkSize);
  } catch (e) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, e);
    return;
  }
  const stream = controller.controlledWritableStream;
  if (
    !WritableStreamCloseQueuedOrInFlight(stream) &&
    stream.state === "writable"
  ) {
    const backpressure = WritableStreamDefaultControllerGetBackpressure(
      controller
    );
    WritableStreamUpdateBackpressure(stream, backpressure);
  }
  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

export function WritableStreamDefaultControllerAdvanceQueueIfNeeded<T>(
  controller: WritableStreamDefaultController<T>
) {
  const stream = controller.controlledWritableStream;
  if (!controller.started) {
    return;
  }
  if (stream.inFlightWriteRequest !== void 0) {
    return;
  }
  const { state } = stream;
  if (state === "closed" || state === "errored") {
    return;
  }
  if (state === "erroring") {
    WritableStreamFinishErroring(stream);
    return;
  }
  if (controller.queue.length === 0) {
    return;
  }
  const writeRecord = PeekQueueValue(controller);
  if (writeRecord === "close") {
    WritableStreamDefaultControllerProcessClose(controller);
  } else {
    WritableStreamDefaultControllerProcessWrite(controller, writeRecord.chunk);
  }
}

export function WritableStreamDefaultControllerErrorIfNeeded<T>(
  controller: WritableStreamDefaultController<T>,
  error
) {
  if (controller.controlledWritableStream.state === "writable") {
    WritableStreamDefaultControllerError(controller, error);
  }
}

export function WritableStreamDefaultControllerProcessClose<T>(
  controller: WritableStreamDefaultController<T>
) {
  const stream = controller.controlledWritableStream;
  WritableStreamMarkCloseRequestInFlight(stream);
  DequeueValue(controller);
  Assert(controller.queue.length === 0);
  const sinkClosePromise = controller.closeAlgorithm();
  WritableStreamDefaultControllerClearAlgorithms(controller);
  sinkClosePromise
    .then(() => {
      WritableStreamFinishInFlightClose(stream);
    })
    .catch(r => {
      WritableStreamFinishInFlightCloseWithError(stream, r);
    });
}

export function WritableStreamDefaultControllerProcessWrite<T>(
  controller: WritableStreamDefaultController<T>,
  chunk
) {
  const stream = controller.controlledWritableStream;
  WritableStreamMarkFirstWriteRequestInFlight(stream);
  const sinkWritePromise = controller.writeAlgorithm(chunk);
  sinkWritePromise.then(() => {
    WritableStreamFinishInFlightWrite(stream);
    const { state } = stream;
    Assert(state === "writable" || state === "erroring");
    DequeueValue(controller);
    if (!WritableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
      const bp = WritableStreamDefaultControllerGetBackpressure(controller);
      WritableStreamUpdateBackpressure(stream, bp);
    }
    WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  });
}

export function WritableStreamDefaultControllerGetBackpressure<T>(
  controller: WritableStreamDefaultController<T>
) {
  return WritableStreamDefaultControllerGetDesiredSize(controller) <= 0;
}

export function WritableStreamDefaultControllerError<T>(
  controller: WritableStreamDefaultController<T>,
  error
) {
  const stream = controller.controlledWritableStream;
  Assert(stream.state === "writable");
  WritableStreamDefaultControllerClearAlgorithms(controller);
  WritableStreamStartErroring(stream, error);
}