import { test } from "../test_util";
import { assertEquals } from "../deps/https/deno.land/std/testing/asserts"
import { ReadableStream,ReadableStreamBYOBReader,ReadableStreamDefaultReader } from "./readable_stream";

test(async function testReadableStream() {
  const src = [0, 1, 2, 3, 4, 5, 6];
  let i = 0;
  const stream = new ReadableStream<number>({
    start: controller => {
      controller.enqueue(src[i++]);
    },
    pull: controller => {
      controller.enqueue(src[i++]);
      if (i >= src.length) {
        controller.close();
        return;
      }
    }
  });
  const reader = stream.getReader() as ReadableStreamDefaultReader<number>;
  for (let i = 0; i < src.length + 1; i++) {
    const { value, done } = await reader.read();
    if (i < 7) {
      assertEquals(value, i);
    } else {
      assertEquals(true, done);
    }
  }
});

test(async function testReadableStream2() {
  const src = [0, 1, 2, 3, 4, 5];
  let i = 0;
  const stream = new ReadableStream(
    {
      pull: controller => {
        console.log(controller.enqueue);
        controller.enqueue(src.slice(i, i + 2));
        i += 2;
        if (i >= src.length) {
          controller.close();
          return;
        }
      }
    },
    {
      size: (chunk: number[]) => {
        return chunk.length;
      }
    }
  );
  const reader = stream.getReader() as ReadableStreamDefaultReader<number>;
  for (let i = 0; i < src.length + 1; i += 2) {
    const { value, done } = await reader.read();
    if (i < src.length) {
      assertEquals(value, [i, i + 1]);
    } else {
      assertEquals(true, done);
    }
  }
});

test(async function testReadableStream3() {
  const src = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const stream = new ReadableStream({
    type: "bytes",
    start: controller => {
      controller.enqueue(src);
    },
    pull: controller => {
      controller.close();
    }
  });
  const reader = stream.getReader({ mode: "byob" });
  assertEquals(reader.constructor, ReadableStreamBYOBReader);
  const buf = new Uint8Array(4);
  const res1 = await reader.read(buf);
  assertEquals(res1.done, false);
  assertEquals([...buf], [0, 1, 2, 3]);
  const res2 = await reader.read(buf);
  assertEquals(res2.done, false);
  assertEquals([...buf], [4, 5, 6, 7]);
  const res3 = await reader.read(buf);
  assertEquals(res3.done, true);
  assertEquals(stream.state, "closed");
});

test(async function testReadableStream4() {
  const src = new Uint16Array([0x1234, 0x5678]);
  const stream = new ReadableStream({
    type: "bytes",
    start: controller => {
      controller.enqueue(src);
    },
    pull: controller => {
      controller.close();
    }
  });
  const reader = stream.getReader({ mode: "byob" });
  assertEquals(reader.constructor, ReadableStreamBYOBReader);
  const buf = new Uint8Array(2);
  const res1 = await reader.read(buf);
  assertEquals(res1.done, false);
  let view = new DataView(buf.buffer);
  assertEquals(view.getInt16(0, true), 0x1234);
  const res2 = await reader.read(buf);
  view = new DataView(buf.buffer);
  assertEquals(res2.done, false);
  assertEquals(view.getInt16(0, true), 0x5678);
  const res3 = await reader.read(buf);
  assertEquals(res3.done, true);
  assertEquals(stream.state, "closed");
});
