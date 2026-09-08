import { describe, expect, test } from "vitest";
import {
  canonicalTargetFrames,
  isAdmittedMp4,
  isValidWriterAck,
  needsClockRecovery,
  PCM_HIGH_WATER_PAGES,
  PCM_LOW_WATER_PAGES,
  PCM_PAGE_BYTES,
  PCM_PAGE_FRAMES,
  PCM_POOL_PAGES,
  PCM_SAMPLE_RATE,
  requiredPcmStorageBytes,
  shouldCollectPreviousRun,
  shouldRemoveStoppedRunTree,
  shouldResumeAfterWriterAck,
  validateCanonicalFlush,
} from "./local-audio-extraction";

describe("I-009 PCM contract", () => {
  test("uses bounded five-second stereo Float32 pages", () => {
    expect(PCM_SAMPLE_RATE).toBe(48000);
    expect(PCM_PAGE_FRAMES).toBe(240000);
    expect(PCM_PAGE_BYTES).toBe(1920000);
    expect(PCM_POOL_PAGES).toBe(4);
    expect(PCM_HIGH_WATER_PAGES).toBe(3);
    expect(PCM_LOW_WATER_PAGES).toBe(1);
  });

  test("collects only a no-longer-current committed predecessor", () => {
    expect(shouldCollectPreviousRun("old", "new", "new")).toBe(true);
    expect(shouldCollectPreviousRun("old", "new", "old")).toBe(false);
    expect(shouldCollectPreviousRun("new", "new", "new")).toBe(false);
    expect(shouldCollectPreviousRun(undefined, "new", "new")).toBe(false);
  });

  test("caps a render-quantum tail to the canonical half-open timeline", () => {
    const targetFrames = canonicalTargetFrames(12);
    expect(targetFrames).toBe(576_000);
    expect(
      validateCanonicalFlush(targetFrames, {
        observedFrames: 576_512,
        retainedFrames: 576_000,
        tailTrimmedFrames: 512,
      }),
    ).toEqual({
      observedFrames: 576_512,
      retainedFrames: 576_000,
      tailTrimmedFrames: 512,
    });
  });

  test("rejects an EOF underrun instead of committing a short cache", () => {
    expect(() =>
      validateCanonicalFlush(576_000, {
        observedFrames: 575_999,
        retainedFrames: 575_999,
        tailTrimmedFrames: 0,
      }),
    ).toThrow("ended 1 frames early");
  });

  test("does not delete a run that won the commit race", () => {
    expect(shouldRemoveStoppedRunTree(true, true, "new", "new")).toBe(false);
    expect(shouldRemoveStoppedRunTree(true, true, "new", "older")).toBe(true);
    expect(shouldRemoveStoppedRunTree(true, false, "staging", undefined)).toBe(
      true,
    );
  });

  test("admits only matching MP4 extension and browser MIME metadata", () => {
    expect(isAdmittedMp4("interview.mp4", "video/mp4")).toBe(true);
    expect(isAdmittedMp4("interview.mp4", "audio/wav")).toBe(false);
    expect(isAdmittedMp4("interview.wav", "video/mp4")).toBe(false);
  });

  test("reserves twenty percent or one page beyond canonical PCM", () => {
    expect(requiredPcmStorageBytes(1)).toBe(2_304_000);
    expect(requiredPcmStorageBytes(900)).toBe(414_720_000);
  });

  test("distinguishes browser suspension from intentional backpressure", () => {
    expect(needsClockRecovery("suspended", false, false, 0)).toBe(true);
    expect(needsClockRecovery("running", true, false, 0)).toBe(true);
    expect(needsClockRecovery("running", false, false, 6_000)).toBe(true);
    expect(needsClockRecovery("running", true, true, 10_000)).toBe(false);
  });

  test("only writer backpressure can auto-resume a paused extractor", () => {
    expect(shouldResumeAfterWriterAck(1, true, false, true)).toBe(true);
    expect(shouldResumeAfterWriterAck(1, true, false, false)).toBe(false);
    expect(shouldResumeAfterWriterAck(2, true, false, true)).toBe(false);
    expect(shouldResumeAfterWriterAck(1, true, true, true)).toBe(false);
  });

  test("rejects malformed writer acknowledgements at the worker boundary", () => {
    const valid = {
      type: "ack",
      index: 0,
      validFrames: 128,
      integrity: "checksum",
      left: new ArrayBuffer(512),
      right: new ArrayBuffer(512),
    };
    expect(isValidWriterAck(valid, 1)).toBe(true);
    expect(isValidWriterAck({ ...valid, index: -1 }, 1)).toBe(false);
    expect(isValidWriterAck({ ...valid, validFrames: 129 }, 1)).toBe(false);
    expect(isValidWriterAck(valid, 0)).toBe(false);
  });
});
