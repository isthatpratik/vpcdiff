import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// ADR 0002: the engine is pure. These rules turn that decision into a check.
const PURE = "The engine is pure (ADR 0002). Do I/O in the CLI, Action, or viewer.";

const nodeModules = [
  "child_process",
  "crypto",
  "dgram",
  "dns",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "process",
  "tls",
  "worker_threads",
];

const impureGlobals = [
  "Buffer",
  "WebSocket",
  "XMLHttpRequest",
  "crypto",
  "fetch",
  "performance",
  "process",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
];

export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**", ".claude/**"]),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeModules.map((name) => ({ name, message: PURE })),
          patterns: [{ group: ["node:*"], message: PURE }],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...impureGlobals.map((name) => ({ name, message: PURE })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: `Date.now() is not deterministic. ${PURE}`,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: `new Date() reads the clock. ${PURE}`,
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: `Date() reads the clock. ${PURE}`,
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: `Math.random() is not deterministic. ${PURE}`,
        },
        {
          selector: "MemberExpression[object.name='globalThis']",
          message: `globalThis can reach impure globals. ${PURE}`,
        },
      ],
    },
  },
]);
