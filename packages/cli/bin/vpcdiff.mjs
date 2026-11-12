#!/usr/bin/env node
/* global process, console */
// A guard that must run on old Node versions too, so it uses nothing newer than they have.
// The program itself (dist/vpcdiff.mjs) needs Node.js 24 and would stop with an unclear error.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`vpcdiff needs Node.js 24 or later (this is ${process.versions.node}). Install a newer Node.js, or open a plan in the web viewer: https://isthatpratik.github.io/vpcdiff/app/`);
  process.exit(2);
}
await import("../dist/vpcdiff.mjs");
