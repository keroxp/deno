import { assert } from "../util/assert.ts";
import * as path from "../path/mod.ts";
import { readFileStrSync, readFileStr } from "./read_file_str.ts";

const testdataDir = path.resolve("fs", "testdata");

Deno.test(function testReadFileSync(): void {
  const jsonFile = path.join(testdataDir, "json_valid_obj.json");
  const strFile = readFileStrSync(jsonFile);
  assert(typeof strFile === "string");
  assert(strFile.length > 0);
});

Deno.test(async function testReadFile(): Promise<void> {
  const jsonFile = path.join(testdataDir, "json_valid_obj.json");
  const strFile = await readFileStr(jsonFile);
  assert(typeof strFile === "string");
  assert(strFile.length > 0);
});
