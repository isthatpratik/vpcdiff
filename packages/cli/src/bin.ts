#!/usr/bin/env node
import { readFileSync } from "node:fs";
import pc from "picocolors";
import { interactive } from "./interactive.ts";
import { run } from "./main.ts";

const argv = process.argv.slice(2);
const terminal = Boolean(process.stdout.isTTY) && !process.env["CI"];

if (argv.length === 0 && terminal && process.stdin.isTTY) {
  process.exitCode = await interactive();
} else {
  process.exitCode = run(argv, {
    stdin: () => readFileSync(0, "utf8"),
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    ...(terminal ? { pretty: pc } : {}),
  });
}
