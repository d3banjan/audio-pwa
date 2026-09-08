# I-012 OPFS processing-store evidence

Date: 2026-09-08

`src/processing/opfs-processing-store.ts` adds an injectable, bounded adapter between the current I-009 storage format and the I-010/I-011 page contracts. It also stages processed planar PCM pages and publishes their immutable manifest/current pointer only after exact full-timeline completion.

Focused automated tests cover:

- exact left/right planar views across multiple source pages;
- malformed manifest, reordered descriptor, and inconsistent frame-total rejection;
- truncated page and per-channel integrity failure;
- source replacement between streamed pages;
- no publication before every processed page closes;
- finite, contiguous, exact-size processed-page validation;
- partial output rejection;
- cancellation cleanup without replacing the prior result;
- stale atomic commit cleanup without replacing the prior result; and
- commit-race-safe predecessor cleanup.

Run the focused evidence with:

```sh
bun x vitest run src/processing/opfs-processing-store.test.ts
```

The focused run passes 9 tests. This is deterministic adapter evidence. A real-browser integration must still exercise IndexedDB transaction aborts, OPFS quota/eviction, file truncation, and recovery after interruption before the persisted result is wired into the user journey.
