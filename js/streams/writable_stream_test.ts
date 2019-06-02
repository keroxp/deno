import { assertEquals } from "../deps/https/deno.land/std/testing/asserts"
import { test } from "../test_util"
import { WritableStream } from "./writable_stream";
import { ReadableStream } from "./readable_stream";

test(async function testWritableStream() {
  const src = [0, 1, 2, 3, 4, 5];
  let i = 0;
  const chunks = [];
  const readable = new ReadableStream({
    pull: controller => {
      controller.enqueue(src[i]);
      i++;
      if (i >= src.length) {
        controller.close();
      }
    }
  });
  const writable = new WritableStream({
    write: chunk => {
      chunks.push(chunk);
    }
  });
  await readable.pipeTo(writable);
  assertEqual(chunks, src);
  assertEqual(readable.state, "closed");
  assertEqual(writable.state, "closed");
});

test(async function testWritableStreamError() {
  const chunks = [];
  const readable = new ReadableStream({
    pull: controller => {
      controller.error("error");
    }
  });
  const writable = new WritableStream({
    write: chunk => {
      chunks.push(chunk);
    }
  });
  await readable.pipeTo(writable);
  assertEqual(readable.state, "errored");
  assertEqual(writable.state, "errored");
});
