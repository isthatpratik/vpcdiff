// The environment for every Terraform or OpenTofu run in this repository (AGENTS.md,
// "Boundaries"). Nothing real may be reached: no cloud profile, no saved login, no
// credentials from the machine that runs the script.
//
// - Only PATH, TMPDIR, and locale variables are passed on from the caller. Everything
//   else (AWS_PROFILE, AWS_ACCESS_KEY_ID, ARM_*, GOOGLE_*, TF_VAR_*, ...) is dropped.
// - HOME is a new empty directory, so ~/.aws, ~/.azure, ~/.config/gcloud, and
//   ~/.terraformrc cannot be found.
// - The AWS shared files point at /dev/null, the instance metadata service is off, and
//   the access keys are fake.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEEP = ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM"];

export function sandboxEnv(extra: Record<string, string> = {}): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "vpcdiff-home-"));
  const kept: Record<string, string> = {};
  for (const k of KEEP) {
    const v = process.env[k];
    if (v) kept[k] = v;
  }
  return {
    ...kept,
    HOME: home,
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_CONFIG_FILE: "/dev/null",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_ACCESS_KEY_ID: "AKIAFAKEFAKEFAKEFAKE",
    AWS_SECRET_ACCESS_KEY: "fake",
    AWS_REGION: "us-east-1",
    CLOUDSDK_CONFIG: join(home, "gcloud"),
    CHECKPOINT_DISABLE: "1",
    TF_IN_AUTOMATION: "1",
    ...extra,
  };
}
