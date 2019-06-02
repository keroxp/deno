
import * as readableStream from "./readable_stream";
import {
  CreateReadableStream,
  ReadableStreamDefaultControllerError,
  ReadableStreamDefaultControllerClose,
  ReadableStreamDefaultControllerCanCloseOrEnqueue,
  ReadableStreamDefaultControllerHasBackpressure,
  ReadableStreamDefaultControllerGetDesiredSize,
  ReadableStreamDefaultController, ReadableStreamDefaultControllerEnqueue,
} from "./readable_stream";
import { defer } from "../defer";
import * as writableStream from "./writable_stream";
import {  CreateWritableStream,WritableStreamDefaultControllerErrorIfNeeded } from "./writable_stream";
import {
  InvokeOrNoop,
  IsNonNegativeNumber,
  MakeSizeAlgorithmFromSizeFunction,
  ValidateAndNormalizeHighWaterMark,
  PromiseCall,
  CreateAlgorithmFromUnderlyingMethod
} from "./misc";
import { Assert } from "./misc";
import * as domTypes from "../dom_types";

export class TransformStream<T = any> {
  constructor(
    transformer: domTypes.Transformer<T>,
    writableStrategy: domTypes.QueuingStrategy,
    readableStrategy: domTypes.QueuingStrategy
  ) {
    let writableSizeFunction = writableStrategy.size;
    let writableHighWaterMark = writableStrategy.highWaterMark;
    let readableSizeFunction = readableStrategy.size;
    let readableHighWaterMark = readableStrategy.highWaterMark;
    const { writableType } = transformer;
    if (writableType !== void 0) {
      throw new RangeError("writable type should not be defined");
    }
    writableSizeFunction = MakeSizeAlgorithmFromSizeFunction(
      writableSizeFunction
    );
    writableHighWaterMark = ValidateAndNormalizeHighWaterMark(
      writableHighWaterMark
    );
    const { readableType } = transformer;
    if (readableType !== void 0) {
      throw new RangeError("readable type should not be defined");
    }
    readableSizeFunction = MakeSizeAlgorithmFromSizeFunction(
      readableSizeFunction
    );
    readableHighWaterMark = ValidateAndNormalizeHighWaterMark(
      readableHighWaterMark
    );
    const startPromise = defer();
    InitializeTransformStream(
      this,
      startPromise,
      writableHighWaterMark,
      writableSizeFunction,
      readableHighWaterMark,
      readableSizeFunction
    );
    SetUpTransformStreamDefaultControllerFromTransformer(this, transformer);
    startPromise.resolve(
      InvokeOrNoop(transformer, "start", this.transformStreamController)
    );
  }

  get readable(): readableStream.ReadableStream<T> | undefined {
    if (!IsTransformStream(this)) {
      throw new TypeError("this is not transform stream");
    }
    return this._readable;
  }

  get writable(): writableStream.WritableStream<T> | undefined {
    if (!IsTransformStream(this)) {
      throw new TypeError("this is not transform stream");
    }
    return this._writable;
  }

  backpressure?: boolean;
  backpressureChangePromise?: domTypes.Defer<any>;
  _readable?:  readableStream.ReadableStream<T>;
  transformStreamController?: TransformStreamDefaultController<T>;
  _writable?: writableStream.WritableStream<T>;
}

export function CreateTransformStream<T>(
  startAlgorithm: domTypes.StartAlgorithm,
  transformAlgorithm: domTypes.TransformAlgorithm<T>,
  flushAlgorithm: domTypes.FlushAlgorithm,
  writableHighWaterMark: number = 1,
  writableSizeAlgorithm: domTypes.SizeAlgorithm = () => 1,
  readableHighWaterMark: number = 1,
  readableSizeAlgorithm: domTypes.SizeAlgorithm = () => 1
): TransformStream<T> {
  Assert(IsNonNegativeNumber(writableHighWaterMark));
  Assert(IsNonNegativeNumber(readableHighWaterMark));
  const stream = Object.create(TransformStream.prototype);
  const startPromise = defer<void>();
  InitializeTransformStream(
    stream,
    startPromise,
    writableHighWaterMark,
    writableSizeAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm
  );
  const controller = Object.create(TransformStreamDefaultController.prototype);
  SetUpTransformStreamDefaultController(
    stream,
    controller,
    transformAlgorithm,
    flushAlgorithm
  );
  startPromise.resolve();
  return stream;
}

export function InitializeTransformStream<T>(
  stream: TransformStream<T>,
  startPromise: domTypes.Defer<any>,
  writableHighWaterMark: number,
  writableSizeAlgorithm: domTypes.SizeAlgorithm,
  readableHighWaterMark: number,
  readableSizeAlgorithm: domTypes.SizeAlgorithm
) {
  const startAlgorithm = () => startPromise;
  const writeAlgorithm: domTypes.WriteAlgorithm<T> = chunk =>
    TransformStreamDefaultSinkWriteAlgorithm(stream, chunk);
  const abortAlgorithm: domTypes.AbortAlgorithm = reason =>
    TransformStreamDefaultSinkAbortAlgorithm(stream, reason);
  const closeAlgorithm = () => TransformStreamDefaultSinkCloseAlgorithm(stream);
  stream._writable = CreateWritableStream(
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    writableHighWaterMark,
    writableSizeAlgorithm
  );
  const pullAlgorithm: domTypes.PullAlgorithm = async () => {
    TransformStreamDefaultSourcePullAlgorithm(stream);
  };
  const cancelAlgorithm: domTypes.CancelAlgorithm = async reason => {
    TransformStreamErrorWritableAndUnblockWrite(stream, reason);
  };
  stream._readable = CreateReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm
  );
  stream.backpressure = void 0;
  stream.backpressureChangePromise = void 0;
  TransformStreamSetBackpressure(stream, true);
  stream.transformStreamController = void 0;
}

export function IsTransformStream(x): x is TransformStream {
  return typeof x === "object" && x.hasOwnProperty("transformStreamController");
}

export function TransformStreamError(
  stream: TransformStream,
  e?: any) {
  ReadableStreamDefaultControllerError(
    stream.readable.readableStreamController,
    e
  );
  TransformStreamErrorWritableAndUnblockWrite(stream, e);
}

export function TransformStreamErrorWritableAndUnblockWrite(
  stream: TransformStream,
  e
) {
  TransformStreamDefaultControllerClearAlgorithms(
    stream.transformStreamController
  );
  WritableStreamDefaultControllerErrorIfNeeded(
    stream.writable.writableStreamController,
    e
  );
  if (stream.backpressure) {
    TransformStreamSetBackpressure(stream, false);
  }
}

export function TransformStreamSetBackpressure(
  stream: TransformStream,
  backpressure: boolean
) {
  Assert(stream.backpressure !== backpressure);
  if (stream.backpressureChangePromise !== void 0) {
    stream.backpressureChangePromise.resolve();
  }
  stream.backpressureChangePromise = defer();
  stream.backpressure = backpressure;
}


export class TransformStreamDefaultController<T = any>
  implements domTypes.TransformStreamController<T> {
  constructor() {
    throw new TypeError(
      "TransformStreamDefaultController is not constructable"
    );
  }

  get desiredSize(): number|null {
    if (!IsTransformStreamDefaultController(this)) {
      throw new TypeError("this is not TransformStreamDefaultController");
    }
    return ReadableStreamDefaultControllerGetDesiredSize(
      this.controlledTransformStream.readable.readableStreamController as ReadableStreamDefaultController<T>
    );
  }

  enqueue(chunk: T) {
    if (!IsTransformStreamDefaultController(this)) {
      throw new TypeError("this is not TransformStreamDefaultController");
    }
    TransformStreamDefaultControllerEnqueue(this, chunk);
  }

  error(reason?: any) {
    if (!IsTransformStreamDefaultController(this)) {
      throw new TypeError("this is not TransformStreamDefaultController");
    }
    TransformStreamDefaultControllerError(this, reason);
  }

  terminate() {
    if (!IsTransformStreamDefaultController(this)) {
      throw new TypeError("this is not TransformStreamDefaultController");
    }
    TransformStreamDefaultControllerTerminate(this);
  }

  controlledTransformStream?: TransformStream<T>;
  flushAlgorithm?: domTypes.FlushAlgorithm;
  transformAlgorithm?: domTypes.TransformAlgorithm<T>;
}

export function IsTransformStreamDefaultController(
  x: any
): x is TransformStreamDefaultController {
  return typeof x === "object" && x.hasOwnProperty("controlledTransformStream");
}

export function SetUpTransformStreamDefaultController<T>(
  stream: TransformStream<T>,
  controller: TransformStreamDefaultController,
  transformAlgorithm: domTypes.TransformAlgorithm<T>,
  flushAlgorithm: domTypes.FlushAlgorithm
) {
  Assert(IsTransformStream(stream));
  Assert(stream.transformStreamController === void 0);
  controller.controlledTransformStream = stream;
  stream.transformStreamController = controller;
  controller.transformAlgorithm = transformAlgorithm;
  controller.flushAlgorithm = flushAlgorithm;
}

export function SetUpTransformStreamDefaultControllerFromTransformer<T>(
  stream: TransformStream<T>,
  transformer: domTypes.Transformer<T>
) {
  Assert(transformer !== void 0);
  const controller = Object.create(TransformStreamDefaultController.prototype);
  let transformAlgorithm: domTypes.TransformAlgorithm<T> = async chunk => {
    try {
      TransformStreamDefaultControllerEnqueue(controller, chunk);
    } catch (e) {
      throw void 0;
    }
    return;
  };
  const method = transformer.transform;
  if (method !== void 0) {
    if (typeof method.call !== "function") {
      throw new TypeError("transformer.transform is not callable");
    }
    transformAlgorithm = async chunk =>
      PromiseCall(method, transformer, chunk, controller);
  }
  const flushAlgorithm = CreateAlgorithmFromUnderlyingMethod(
    transformer,
    "flush",
    0,
    controller
  );
  SetUpTransformStreamDefaultController<T>(
    stream,
    controller,
    transformAlgorithm,
    flushAlgorithm
  );
}

export function TransformStreamDefaultControllerClearAlgorithms(
  controller: TransformStreamDefaultController
) {
  controller.transformAlgorithm = void 0;
  controller.flushAlgorithm = void 0;
}

export function TransformStreamDefaultControllerEnqueue<T>(
  controller: TransformStreamDefaultController<T>,
  chunk
) {
  const stream = controller.controlledTransformStream;
  const readableController = stream.readable.readableStreamController as ReadableStreamDefaultController<T>;
  if (!ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController)) {
    throw new TypeError("readable stream controller cannot close on enqueue");
  }
  try {
    ReadableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    TransformStreamErrorWritableAndUnblockWrite(stream, e);
    throw stream.readable.storedError;
  }
  const backpressure = ReadableStreamDefaultControllerHasBackpressure(
    readableController
  );
  if (backpressure !== stream.backpressure) {
    Assert(backpressure);
    TransformStreamSetBackpressure(stream, true);
  }
}

export function TransformStreamDefaultControllerError(
  controller: TransformStreamDefaultController,
  e
) {
  TransformStreamError(controller.controlledTransformStream, e);
}

export function TransformStreamDefaultControllerPerformTransform<T>(
  controller: TransformStreamDefaultController<T>,
  chunk: T
) {
  controller.transformAlgorithm(chunk).catch(r => {
    TransformStreamError(controller.controlledTransformStream, r);
    throw r;
  });
}

export function TransformStreamDefaultControllerTerminate<T>(
  controller: TransformStreamDefaultController<T>
) {
  const stream = controller.controlledTransformStream;
  const readableController = stream.readable.readableStreamController;
  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController as ReadableStreamDefaultController<T>)) {
    ReadableStreamDefaultControllerClose(readableController);
  }
  const error = new TypeError("stream ended");
  TransformStreamErrorWritableAndUnblockWrite(stream, error);
}

export function TransformStreamDefaultSinkWriteAlgorithm<T>(
  stream: TransformStream<T>,
  chunk: T
) {
  Assert(stream.writable.state === "writable");
  const controller = stream.transformStreamController;
  if (stream.backpressure) {
    const p = stream.backpressureChangePromise;
    Assert(p !== void 0);
    return p.then(() => {
      const writable = stream.writable;
      const { state } = writable;
      if (state === "erroring") {
        throw writable.storedError;
      }
      Assert(state === "writable");
      return TransformStreamDefaultControllerPerformTransform(
        controller,
        chunk
      );
    });
  }
  return TransformStreamDefaultControllerPerformTransform(controller, chunk);
}

export async function TransformStreamDefaultSinkAbortAlgorithm(
  stream: TransformStream,
  reason?: any
) {
  TransformStreamError(stream, reason);
}

export function TransformStreamDefaultSinkCloseAlgorithm<T>(
  stream: TransformStream<T>
) {
  const { readable } = stream;
  const controller = stream.transformStreamController;
  const flushPromise = controller.flushAlgorithm();
  TransformStreamDefaultControllerClearAlgorithms(controller);
  return flushPromise
    .then(() => {
      if (readable.state === "errored") {
        throw readable.storedError;
      }
      const readableController = readable.readableStreamController;
      if (
        ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController as ReadableStreamDefaultController<T>)
      ) {
        ReadableStreamDefaultControllerClose(readableController);
      }
    })
    .catch(r => {
      TransformStreamError(stream, r);
      throw readable.storedError;
    });
}

export function TransformStreamDefaultSourcePullAlgorithm(
  stream: TransformStream
) {
  Assert(stream.backpressure !== void 0);
  Assert(stream.backpressureChangePromise !== void 0);
  TransformStreamSetBackpressure(stream, false);
  return stream.backpressureChangePromise;
}

