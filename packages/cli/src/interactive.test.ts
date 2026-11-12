import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSymlink } from "./interactive.ts";

describe("isSymlink", () => {
  it("sees a link, a dangling link, a file, a folder, and a missing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "vpcdiff-test-"));
    try {
      writeFileSync(join(dir, "file.md"), "x");
      mkdirSync(join(dir, "folder"));
      symlinkSync(join(dir, "file.md"), join(dir, "link.md"));
      symlinkSync(join(dir, "nowhere"), join(dir, "dangling.md"));
      expect(isSymlink(join(dir, "link.md"))).toBe(true);
      expect(isSymlink(join(dir, "dangling.md"))).toBe(true);
      expect(isSymlink(join(dir, "file.md"))).toBe(false);
      expect(isSymlink(join(dir, "folder"))).toBe(false);
      expect(isSymlink(join(dir, "missing.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
