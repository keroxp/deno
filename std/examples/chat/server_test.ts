// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
import { assert, assertEquals } from "../../testing/asserts.ts";
import { TextProtoReader } from "../../textproto/mod.ts";
import { BufReader } from "../../io/bufio.ts";
import { connectWebSocket, WebSocket } from "../../ws/mod.ts";
import { randomPort } from "../../http/test_util.ts";
import { delay } from "../../util/async.ts";

const port = randomPort();

const { test } = Deno;

async function startServer(): Promise<Deno.Process> {
  const server = Deno.run({
    cmd: [
      Deno.execPath(),
      "--allow-net",
      "--allow-read",
      "server.ts",
      `127.0.0.1:${port}`
    ],
    cwd: "examples/chat",
    stdout: "piped"
  });
  try {
    assert(server.stdout != null);
    const r = new TextProtoReader(new BufReader(server.stdout));
    const s = await r.readLine();
    assert(s !== Deno.EOF && s.includes("chat server starting"));
  } catch (err) {
    server.stdout!.close();
    server.close();
  }

  return server;
}

test({
  name: "GET / should serve html",
  async fn() {
    const server = await startServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`);
      assertEquals(resp.status, 200);
      assertEquals(resp.headers.get("content-type"), "text/html");
      const html = await resp.body.text();
      assert(html.includes("ws chat example"), "body is ok");
    } finally {
      server.close();
      server.stdout!.close();
    }
    await delay(10);
  }
});

test({
  name: "GET /ws should upgrade conn to ws",
  async fn() {
    const server = await startServer();
    let ws: WebSocket | undefined;
    try {
      ws = await connectWebSocket(`http://127.0.0.1:${port}/ws`);
      const it = ws.receive();
      assertEquals((await it.next()).value, "Connected: [1]");
      ws.send("Hello");
      assertEquals((await it.next()).value, "[1]: Hello");
    } finally {
      server.close();
      server.stdout!.close();
      ws!.conn.close();
    }
  }
});
