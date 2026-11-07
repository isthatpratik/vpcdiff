// Nothing real in this repository, and nothing real in a fixture run (AGENTS.md,
// "Boundaries"): these tests fail if a profile, a credential, a real account ID, or the
// caller's environment could reach Terraform or OpenTofu.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sandboxEnv } from "../scripts/sandbox-env.ts";

const root = import.meta.dirname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const fixtureFiles = files(root).filter((f) => /\.(tf|json|md)$/.test(f));

describe("the run environment", () => {
  it("drops every cloud variable of the caller", () => {
    const saved = { ...process.env };
    process.env.AWS_PROFILE = "someone-elses-profile";
    process.env.AWS_SESSION_TOKEN = "real-token";
    process.env.ARM_CLIENT_SECRET = "real-secret";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/real/key.json";
    process.env.TF_VAR_password = "real";
    try {
      const env = sandboxEnv();
      expect(Object.keys(env).filter((k) => /^(ARM_|GOOGLE_|AZURE_|TF_VAR_)/.test(k))).toEqual([]);
      expect(env.AWS_PROFILE).toBeUndefined();
      expect(env.AWS_SESSION_TOKEN).toBeUndefined();
      expect(env.AWS_ACCESS_KEY_ID).toBe("AKIAFAKEFAKEFAKEFAKE");
    } finally {
      process.env = saved;
    }
  });

  it("uses an empty home, so no saved login or profile can be found", () => {
    const env = sandboxEnv();
    expect(env.HOME).not.toBe(homedir());
    expect(readdirSync(env.HOME as string)).toEqual([]);
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe("/dev/null");
    expect(env.AWS_CONFIG_FILE).toBe("/dev/null");
    expect(env.AWS_EC2_METADATA_DISABLED).toBe("true");
  });
});

describe("the fixtures", () => {
  it("name no profile, role, key, or token in their configuration", () => {
    for (const f of fixtureFiles.filter((x) => x.endsWith(".tf"))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\b(profile|assume_role|shared_credentials_files?|shared_config_files?|access_key|secret_key|access_token|client_secret|credentials)\s*=/);
    }
  });

  it("hold no account ID except AWS's documentation example, and no access key", () => {
    for (const f of fixtureFiles) {
      const text = readFileSync(f, "utf8");
      const ids = (text.match(/\b\d{12}\b/g) ?? []).filter((n) => n !== "123456789012");
      expect(ids, f).toEqual([]);
      expect(text, f).not.toMatch(/\bA(KIA|SIA)[A-Z0-9]{12,}\b/);
    }
  });
});
