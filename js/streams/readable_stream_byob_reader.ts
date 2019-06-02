import { defer } from "../defer";
import {
  IsReadableStream,
  IsReadableStreamLocked,
  ReadableStream
} from "./readable_stream";
import { Assert, isArrayBufferView } from "./util";
import {
  ReadableStreamReaderGenericCancel,
  ReadableStreamReaderGenericRelease
} from "./readable_stream_reader";
import {
  IsReadableByteStreamController,
  ReadableByteStreamControllerPullInto,
  ReadableByteStreamController
} from "./readable_byte_stream_controller";
import * as domTypes from "../dom_types";
export class ReadableStreamBYOBReader
  implements domTypes.ReadableStreamReader<ArrayBufferView> {
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

export function IsReadableStreamBYOBReader(a): a is ReadableStreamBYOBReader {
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
