import { createRequire } from 'node:module';

/**
 * Read the package version for the outbound User-Agent. Scryfall and TCGCSV
 * both ask that the header carry the application's name and version, so it is read from
 * `package.json` rather than hardcoded, where it would silently drift on every
 * release. `createRequire` resolves relative to this module, which lands on the
 * project root under `tsx`, Vitest, and the compiled `dist/` layout alike (the
 * Dockerfile copies `package.json` next to `dist/`). A static import is not an
 * option: `package.json` sits outside `rootDir`, so importing it would break
 * the build.
 */
function readPackageVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const PROJECT_VERSION = readPackageVersion();
