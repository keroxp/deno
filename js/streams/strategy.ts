import * as domTypes from "../dom_types";
export class ByteLengthQueuingStrategy
  implements domTypes.ByteLengthQueuingStrategy {
  constructor(opts?: { highWaterMark?: number }) {
    this.highWaterMark = highWaterMark;
  }

  highWaterMark?: number;

  size(chunk: { byteLength: number }): number {
    return chunk.byteLength;
  }
}

export class CountQueuingStrategy implements domTypes.CountQueuingStrategy {
  constructor({ highWaterMark }: { highWaterMark?: number }) {
    this.highWaterMark = highWaterMark;
  }

  highWaterMark?: number;

  size(_): number {
    return 1;
  }
}
