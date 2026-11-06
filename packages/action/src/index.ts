import { appendFileSync, readFileSync } from "node:fs";
import { run } from "./main.ts";

process.exitCode = await run({
  vars: process.env,
  readFile: (p) => readFileSync(p, "utf8"),
  appendFile: (p, t) => appendFileSync(p, t),
  fetch: globalThis.fetch,
  log: (line) => process.stdout.write(`${line}\n`),
});
