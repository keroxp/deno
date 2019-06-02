import * as domTypes from "../dom_types";
export class ByteLengthQueuingStrategy
  implements domTypes.QueuingStrategy {
  constructor({ highWaterMark }: {highWaterMark?: number}) {
    this.highWaterMark = highWaterMark;
  }

  highWaterMark?: number;

  size(chunk: { byteLength: number }): number {
    return chunk.byteLength;
  }
}

export class CountQueuingStrategy implements domTypes.QueuingStrategy {
  constructor({ highWaterMark }: { highWaterMark?: number }) {
    this.highWaterMark = highWaterMark;
  }

  highWaterMark?: number;

  size(): number {
    return 1;
  }
}
