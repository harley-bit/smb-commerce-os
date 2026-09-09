import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SIGNING_ARTIFACT_EXTENSIONS = [".jks", ".p8", ".p12", ".key", ".mobileprovision", ".pem", ".keystore"];

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "ios", "android", "dist", ".expo"]);

export function findLocalSigningArtifacts(rootDir: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (SIGNING_ARTIFACT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
        found.push(relative(rootDir, fullPath));
      }
    }
  };

  walk(rootDir);
  return found;
}

interface RemoteCredentialsValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRemoteCredentials(config: unknown): RemoteCredentialsValidationResult {
  const errors: string[] = [];
  const build = isRecord(config) ? config["build"] : undefined;

  if (!isRecord(build)) {
    return { valid: false, errors: ["eas.json: missing \"build\" section"] };
  }

  for (const [profileName, profile] of Object.entries(build)) {
    for (const platform of ["ios", "android"] as const) {
      const platformConfig = isRecord(profile) ? profile[platform] : undefined;
      const credentialsSource = isRecord(platformConfig) ? platformConfig["credentialsSource"] : undefined;

      if (credentialsSource !== "remote") {
        errors.push(
          `build.${profileName}.${platform}: credentialsSource must be "remote", got ${String(JSON.stringify(credentialsSource))}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
