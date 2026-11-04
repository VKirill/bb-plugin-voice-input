import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The host sources import siblings as "./x.js" for the bundler; map those to the .ts files.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
const { ensureDaemon } = await import("../src/daemon.ts");
const { hostPaths } = await import("../src/paths.ts");

test("a busy daemon that accepts but answers ping late keeps its socket", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "vi-"));
  const paths = hostPaths(dataDir);
  const held: Socket[] = [];
  // Like the old single-threaded daemon mid-transcription: accepts, never replies.
  const server = createServer((socket) => held.push(socket));
  await new Promise<void>((resolve) => server.listen(paths.socketPath("whisper"), resolve));
  try {
    await ensureDaemon(paths, "whisper", 60);
    assert.ok(existsSync(paths.socketPath("whisper")), "busy daemon's socket must not be unlinked");
  } finally {
    for (const socket of held) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a dead daemon socket is still replaced", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "vi-"));
  const paths = hostPaths(dataDir);
  await writeFile(paths.socketPath("whisper"), "");
  try {
    // No venv in the temp dir, so the restart fails after clearing the stale socket.
    await assert.rejects(ensureDaemon(paths, "whisper", 60));
    assert.equal(existsSync(paths.socketPath("whisper")), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
