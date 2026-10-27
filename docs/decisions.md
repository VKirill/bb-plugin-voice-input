---
title: Decisions
type: decisions
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: medium
tags: [decisions, storage, compatibility]
sources:
  - server.ts
  - src/contract.ts
  - src/paths.ts
  - host.ts
  - src/settings-store.ts
  - src/secret-store.ts
  - src/ai-service-compat.ts
  - src/host-contract.ts
---
# Decisions

TL;DR: The code records intentional boundaries for custom settings UI, host-local secrets, and SDK-compatible AI service registration (`server.ts:154-169`, `src/secret-store.ts:1-6`, `src/ai-service-compat.ts:1-27`).

## 001. Store plugin settings separately from BB setting descriptors (active)

**Context:** The plugin source says BB renders declarative setting descriptors above the plugin page and that this duplicated the tabbed settings form (`server.ts:154-159`, `src/settings-store.ts:1-7`).

**Decision:** Store non-secret values in the plugin key-value store and render the settings in the plugin page. Store keys separately on the recognition host (`server.ts:160-169`, `src/paths.ts:8-12`).

**Status:** Active.

**Consequences:** The settings page owns the user-facing controls; settings are not read back as descriptors. Server settings, host config, and host secrets have separate storage locations (`server.ts:194-230`, `server.ts:474-493`).

## 002. Keep provider secrets on the recognition host (active)

**Context:** Transcription runs on the recognition host, so the host needs the provider key; source comments identify server-pushed config as a separate channel (`src/secret-store.ts:1-6`, `src/contract.ts:1-4`).

**Decision:** Store provider key values in `secrets.json`, write that file with mode `0600`, and push only non-secret key-source settings in normal config (`src/secret-store.ts:36-53`, `server.ts:194-230`, `server.ts:474-490`).

**Status:** Active.

**Consequences:** Key status can be shown without returning values, and the recognition host can resolve the key locally (`host.ts:445-455`, `host.ts:127-140`).

## 003. Adapt AI service registration to the SDK declaration shapes (active)

**Context:** The compatibility module documents a `kinds` declaration difference between BB SDK versions (`src/ai-service-compat.ts:1`).

**Decision:** Try declaration variants in order and stop at the first accepted registration (`src/ai-service-compat.ts:8-27`).

**Status:** Active.

**Consequences:** Registration supports the declaration shapes in the adapter; if all attempts throw, the final error is rethrown (`src/ai-service-compat.ts:18-27`).
