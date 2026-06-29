import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sweepStaleTempEntries } from "../lib/temp-artifacts.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-temp-sweep-"));
try {
  const missing = await sweepStaleTempEntries(path.join(root, "missing"), { ttlMs: 1_000 });
  assert.deepEqual(missing, [], "missing directory must sweep to nothing without throwing");

  const staleDir = path.join(root, "stale-upload");
  await mkdir(staleDir, { recursive: true });
  await writeFile(path.join(staleDir, "attachment.txt"), "old", "utf8");
  const freshDir = path.join(root, "fresh-upload");
  await mkdir(freshDir, { recursive: true });
  const staleFile = path.join(root, "stale-export.html");
  await writeFile(staleFile, "old", "utf8");
  const freshFile = path.join(root, "fresh-export.html");
  await writeFile(freshFile, "new", "utf8");

  const past = new Date(Date.now() - 60_000);
  await utimes(staleDir, past, past);
  await utimes(staleFile, past, past);

  const removed = await sweepStaleTempEntries(root, { ttlMs: 30_000 });
  assert.deepEqual(new Set(removed), new Set([staleDir, staleFile]), "only entries older than the TTL are removed");

  const remaining = (await readdir(root)).sort();
  assert.deepEqual(remaining, ["fresh-export.html", "fresh-upload"], "fresh entries must survive the sweep");

  const repeat = await sweepStaleTempEntries(root, { ttlMs: 30_000 });
  assert.deepEqual(repeat, [], "repeat sweep with no stale entries removes nothing");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("temp-artifacts-harness.test.mjs passed");
