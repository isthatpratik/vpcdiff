import type { Result } from "@vpcdiff/engine";
import type { Request, Response } from "./worker.ts";

let worker: Worker | undefined;
let next = 1;
const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  return worker;
}

/** Analyzes plan JSON text in the worker. */
export function analyzeInWorker(text: string): Promise<Result> {
  const id = next++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text } satisfies Request);
  });
}
