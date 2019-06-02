import { ReadableStream, CreateReadableStream } from "./readable_stream";
import { defer } from "../defer";
import { WritableStream, CreateWritableStream } from "./writable_stream";
import {
  InvokeOrNoop,
  IsNonNegativeNumber,
  MakeSizeAlgorithmFromSizeFunction,
  ValidateAndNormalizeHighWaterMark
} from "./misc";
import {
  TransformStreamDefaultController,
  SetUpTransformStreamDefaultController,
  SetUpTransformStreamDefaultControllerFromTransformer,
  TransformStreamDefaultControllerClearAlgorithms,
  TransformStreamDefaultSinkAbortAlgorithm,
  TransformStreamDefaultSinkCloseAlgorithm,
  TransformStreamDefaultSinkWriteAlgorithm,
  TransformStreamDefaultSourcePullAlgorithm
} from "./transform_stream_controller";
import { Assert } from "./util";
import { ReadableStreamDefaultControllerError } from "./readable_stream_controller";
import { WritableStreamDefaultControllerErrorIfNeeded } from "./writable_stream_controller";
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

  get readable(): domTypes.ReadableStream<T> | undefined {
    if (!IsTransformStream(this)) {
      throw new TypeError("this is not transform stream");
    }
    return this._readable;
  }

  get writable(): domTypes.WritableStream<T> | undefined {
    if (!IsTransformStream(this)) {
      throw new TypeError("this is not transform stream");
    }
    return this._writable;
  }

  backpressure?: boolean;
  backpressureChangePromise?: domTypes.Defer<any>;
  _readable?: ReadableStream<T>;
  transformStreamController?: TransformStreamDefaultController<T>;
  _writable?: WritableStream<T>;
}

export function CreateTransformStream<T>(
  startAlgorithm: domTypes.StartAlgorithm,
  transformAlgorithm: domTypes.TransformAlgorithm<T>,
  flushAlgorithm: domTypes.FlushAlgorithm,
  writableHighWaterMark: number = 1,
  writableSizeAlgorithm: domTypes.SizeAlgorithm = () => 1,
  readableHighWaterMark: number = 1,
  readableSizeAlgorithm: domTypes.SizeAlgorithm = () => 1
): TransformStream {
  Assert(IsNonNegativeNumber(writableHighWaterMark));
  Assert(IsNonNegativeNumber(readableHighWaterMark));
  const stream = Object.create(TransformStream.prototype);
  const startPromise = defer();
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
  startPromise.resolve(startPromise());
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

export function TransformStreamError(stream: TransformStream, e) {
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
