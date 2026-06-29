import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Remove direct children (files or directories) of dir whose mtime is older
 * than ttlMs. Used to reclaim pi-webui upload/native-export temp artifacts;
 * a missing dir or racing removals are not errors.
 *
 * @returns {Promise<string[]>} absolute paths that were removed
 */
export async function sweepStaleTempEntries(dir, { ttlMs, now = Date.now() } = {}) {
  const removed = [];
  if (!Number.isFinite(ttlMs) || ttlMs < 0) return removed;

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return removed;
  }

  for (const name of entries) {
    const entryPath = path.join(dir, name);
    try {
      const stats = await stat(entryPath);
      if (now - stats.mtimeMs <= ttlMs) continue;
      await rm(entryPath, { recursive: true, force: true });
      removed.push(entryPath);
    } catch {
      // Entry vanished mid-sweep or is not removable; leave it for the next pass.
    }
  }
  return removed;
}
