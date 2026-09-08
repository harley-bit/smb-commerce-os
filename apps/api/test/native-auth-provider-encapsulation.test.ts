import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..");

// The only two production-source files allowed to reference
// `NativeAuthProvider` by name: its own definition, and the composition
// root that binds it to the `AuthProvider` interface. Every other
// production module — including everything in `packages/domain` — must
// depend on the interface only (ADR-002). Dedicated unit tests of the
// concrete class (e.g. `native-auth-provider.test.ts`) are expected to
// import it directly and are out of scope for this check, same as this
// file is.
const ALLOWED_FILES = new Set(["apps/api/src/auth/NativeAuthProvider.ts", "apps/api/src/app.ts"]);

const SCAN_DIRS = ["apps/api/src", "packages/domain/src", "packages/db/src"];

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("NativeAuthProvider encapsulation (ADR-002 provider seam)", () => {
  it("is never referenced by name outside its definition and the composition root", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      const absoluteDir = join(REPO_ROOT, dir);
      for (const file of collectFiles(absoluteDir)) {
        const relPath = relative(REPO_ROOT, file).split("\\").join("/");
        if (ALLOWED_FILES.has(relPath)) {
          continue;
        }
        const content = readFileSync(file, "utf-8");
        if (content.includes("NativeAuthProvider")) {
          offenders.push(relPath);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
