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

test("a stopped daemon does not delete the socket of the daemon that replaced it", async () => {
  const { spawn } = await import("node:child_process");
  const { copyFile } = await import("node:fs/promises");
  const { connect } = await import("node:net");
  const { stopDaemon } = await import("../src/daemon.ts");

  const dataDir = await mkdtemp(join(tmpdir(), "vi-"));
  const paths = hostPaths(dataDir);
  const socketPath = paths.socketPath("whisper");
  await copyFile(join(import.meta.dirname, "..", "python", "voiced.py"), join(dataDir, "voiced.py"));
  await writeFile(
    join(dataDir, "engines.py"),
    "class EngineError(Exception): pass\nclass TranscriptionRequest: pass\nENGINES = {}\n",
  );
  const daemon = spawn("python3", [join(dataDir, "voiced.py"), socketPath], { stdio: "ignore" });
  const exited = new Promise((resolve) => daemon.once("exit", resolve));
  const replacement = createServer();
  try {
    for (let i = 0; i < 100 && !existsSync(socketPath); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(socketPath), "daemon did not start");

    await stopDaemon(paths, "whisper");
    // A replacement takes the path right away, before the old process has exited.
    await new Promise<void>((resolve) => replacement.listen(socketPath, resolve));
    await exited;

    assert.ok(existsSync(socketPath), "old daemon unlinked the replacement's socket");
    await new Promise<void>((resolve, reject) => {
      const client = connect(socketPath, () => {
        client.end();
        resolve();
      });
      client.on("error", reject);
    });
  } finally {
    daemon.kill();
    await new Promise((resolve) => replacement.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
