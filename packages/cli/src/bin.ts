#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./main.ts";

process.exitCode = run(process.argv.slice(2), {
  stdin: () => readFileSync(0, "utf8"),
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
