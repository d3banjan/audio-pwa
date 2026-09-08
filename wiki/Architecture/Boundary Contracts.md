---
title: "Boundary Contracts"
version: "2.2"
status: active-design
updated: 2026-09-07
tags:
  - audio-workstation
  - contracts
  - architecture
---

# Boundary Contracts

Frontend and client-side backend exchange versioned, serializable messages. Large audio data moves by ownership transfer or committed storage reference; it is never embedded in UI state.

## Shared envelope

```ts
type MessageEnvelope<TType extends string, TPayload> = Readonly<{
  schemaVersion: 1;
  type: TType;
  requestId: string;
  projectId?: string;
  jobId?: string;
  generation?: number;
  payload: TPayload;
}>;
```

IDs are opaque UUID-based strings. `jobId` distinguishes validation, processing, and export jobs; `generation` invalidates stale transport, page, peak, and automation events after seek/cancel/restart. Receivers validate schema and payload at trust boundaries; TypeScript types alone do not validate worker or stored input.

## Command/event map

| Frontend command | Backend event/result | Key failure states |
| --- | --- | --- |
| `probeCapabilities` | Per-subsystem capability snapshot with runtime/browser evidence | unsupported API, adapter null, quota unavailable |
| `hydrateAssets` / `cancelJob` | Byte/stage progress, verified package manifest, readiness | offline, integrity, quota, cancellation |
| `validateSource(file)` | Container/codec/rate/channels/duration and admission result | corrupt, unsupported, too large, allocation risk |
| `planProfiles(source, capabilities, catalog)` | Qualified quality/output profiles with resource and ETA ranges | no feasible profile, missing model, quota uncertainty, unqualified encoder |
| `startProcessing(project)` | Stage/chunk progress, checkpoints, committed-result manifest | provider loss, storage write, worker termination |
| `setTransport(action)` | phase, canonical frame, context anchor, buffering | stale generation, underrun, device/output change |
| `setMixSnapshot(partial)` | normalized authoritative mix snapshot | invalid ranges/version mismatch |
| `requestPeakTiles(range, level)` | bounded visible peak tile references/data | missing/stale analysis page |
| `startExport(config, destination)` | frame progress, measured loudness/peak, verified output | destination/quota, state mismatch, safety verification |
| `deleteProject(projectId)` | deletion receipt and remaining storage | active job, partial cleanup requiring retry |

## PCM page descriptor

```ts
type PcmPage = Readonly<{
  schemaVersion: 1;
  projectId: string;
  assetId: string;
  generation: number;
  sampleRate: 48000;
  channels: 1 | 2;
  startFrame: number;
  validFrames: number;
  format: "f32-planar";
  ownership: "transfer" | "opfs";
  byteLength: number;
  checksum?: string;
}>;
```

Intervals are half-open. All integer fields are non-negative safe integers; `startFrame + validFrames` must remain safe. A transfer message lists its ArrayBuffers explicitly and the sender relinquishes them. An OPFS reference is immutable once committed.

## Job and error contract

Progress contains `stage`, `completedUnits`, optional `totalUnits`, units, checkpoint, and whether cancellation is currently immediate or pending a safe boundary. An ETA is a frontend estimate from measured progress, not a backend promise.

Errors contain a stable code, subsystem, recoverability, retry checkpoint, human-safe detail, and optional cause for local diagnostics. Never send raw filenames or audio-derived data to remote logging. A recoverable error cannot mutate the last committed manifest.

## Resource-plan contract

```ts
type ResourcePlan = Readonly<{
  schemaVersion: 1;
  profileId: string;
  sourceFidelity: "preserved-picture" | "audio-only";
  modelArtifactIds: readonly string[];
  provider: "webgpu" | "wasm-mt" | "wasm-st";
  persistentBytes: {
    source: number;
    models: number;
    project: number;
    peakTemporary: number;
    output: number;
    reserve: number;
  };
  peakWorkingBytes: { estimated: number; confidence: "low" | "medium" | "high" };
  etaSeconds: { low: number; high: number; confidence: "low" | "medium" | "high" };
  assumptions: readonly string[];
  feasible: boolean;
  blockers: readonly string[];
}>;
```

All byte fields are finite non-negative safe integers and use decimal bytes in the UI. Plans include measurement environment/version and become stale when the source, selected artifact, provider, output, quota, or benchmark inputs change. The backend returns facts and ranges; the frontend never invents compatibility from a raw API-presence flag.

## Mix snapshot

Preview and export use one immutable, versioned snapshot containing four bus gains, explicit export inclusion, audition-only mute/solo, aligned dialogue wet/dry, filters, stereo width, VAD threshold/version, derived speech-mask version, ducking parameters/events, timeline edits, limiter/version, and output policy. D-015 stem export consumes the accepted processing and explicit inclusion fields but ignores audition mute/solo and the master loudness/limiter stage. Backend validation clamps nothing silently; invalid state is rejected with a field-specific error.

## Current implementation mapping

`src/audio-domain/` provides pure canonical timeline, resource-admission, and VAD interval primitives. `src/lib/app-state.ts` implements legal project/job/transport transitions and rejects stale events; `src/lib/device-state.ts` independently represents shell and model readiness. Cross-worker schemas belong under `src/contracts/` when worker commands begin.

The current foundation also exposes a user-invoked, read-only capability report from `src/capabilities/browser-capabilities.ts`. It probes secure context, isolation, logical CPUs, storage/persistence, OPFS, IndexedDB, service-worker API, SharedArrayBuffer, WebAssembly, AudioContext/AudioWorklet, and WebGPU adapter/device/limits/features. When a device is created it runs a tiny storage-buffer compute correctness check and attaches a device-loss observer. The report never sends telemetry or audio. `onnxModelQualification` remains `unknown` until the pinned ONNX Runtime Web model and its operators have been tested; adapter availability is not model qualification.

See [[Frontend Architecture]], [[Client-Side Backend Architecture]], and [[Ingestion and Timeline]].
