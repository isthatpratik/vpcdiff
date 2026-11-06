// Runs the engine off the main thread. Messages carry plan text in and a result out;
// nothing leaves the browser.
import { analyze, PlanError, type Result } from "@vpcdiff/engine";

export type Request = { id: number; text: string };
export type Response = { id: number; ok: true; result: Result } | { id: number; ok: false; error: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (m: Response) => void };

scope.onmessage = (e) => {
  const { id, text } = e.data;
  let plan: unknown;
  try {
    plan = JSON.parse(text);
  } catch {
    scope.postMessage({ id, ok: false, error: "This file is not valid JSON. Open the output of terraform show -json." });
    return;
  }
  try {
    scope.postMessage({ id, ok: true, result: analyze(plan) });
  } catch (err) {
    const message = err instanceof PlanError ? `${err.message} Run terraform show -json tfplan and open that file.` : `The engine stopped with an error: ${String(err)}`;
    scope.postMessage({ id, ok: false, error: message });
  }
};
