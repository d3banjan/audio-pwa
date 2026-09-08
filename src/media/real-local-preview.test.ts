import { describe, expect, test } from "vitest";
import {
  createDefaultState,
  createRealMediaPreviewController,
  deriveBatchEnrichmentOptions,
  deriveProcessingParameters,
  isLikelySupportedAudioVideoFile,
} from "./real-local-preview";

type Listener = (event: { type: string }) => void;

class FakeAudioParam {
  value = 0;
  setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
  cancelScheduledValues(_time?: number): void {}
}

class FakeAudioNode {
  constructor(readonly context: FakeAudioContext) {}
  connect(_node?: unknown, _output?: number, _input?: number): this {
    return this;
  }
  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
  channelCount = 1;
  channelCountMode: ChannelCountMode = "max";
  channelInterpretation: ChannelInterpretation = "speakers";
}

class FakeBiquadFilterNode extends FakeGainNode {
  Q = new FakeAudioParam();
  frequency = new FakeAudioParam();
  type = "";
}

class FakeCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam();
  ratio = new FakeAudioParam();
}

class FakeMediaElementSourceNode extends FakeAudioNode {}

class FakeChannelSplitterNode extends FakeAudioNode {}

class FakeChannelMergerNode extends FakeAudioNode {}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new FakeAudioNode(this);
  readonly gains: FakeGainNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  createMediaElementSource(): FakeMediaElementSourceNode {
    return new FakeMediaElementSourceNode(this);
  }
  createGain(): FakeGainNode {
    const gain = new FakeGainNode(this);
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode(this);
  }
  createDynamicsCompressor(): FakeCompressorNode {
    return new FakeCompressorNode(this);
  }
  createChannelSplitter(_channels?: number): FakeChannelSplitterNode {
    return new FakeChannelSplitterNode(this);
  }
  createChannelMerger(_channels?: number): FakeChannelMergerNode {
    return new FakeChannelMergerNode(this);
  }
}

class FakeMediaElement {
  src = "";
  muted = false;
  currentTime = 0;
  duration = 0;
  paused = true;
  private readonly listeners = new Map<string, Set<Listener>>();

  play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent({ type: "play" });
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.dispatchEvent({ type: "pause" });
  }

  load(): void {
    this.dispatchEvent({ type: "loadedmetadata" });
  }

  removeAttribute(_name: string): void {
    this.src = "";
  }

  addEventListener(type: string, listener: Listener, _options?: unknown): void {
    let next = this.listeners.get(type);
    if (!next) {
      next = new Set();
      this.listeners.set(type, next);
    }
    next.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string }): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }
}

describe("real media preview helpers", () => {
  test("derive processing parameters maps control bounds", () => {
    const params = deriveProcessingParameters({
      dialogueClean: 50,
      musicWeight: 100,
      width: 80,
      ducking: 30,
      loudnessPreset: "streaming-loud",
    });
    expect(params.highpassFrequency).toBeGreaterThan(60);
    expect(params.highpassFrequency).toBeLessThanOrEqual(120);
    expect(params.presenceGain).toBeGreaterThanOrEqual(0.5);
    expect(params.compressorRatio).toBeGreaterThan(1);
    expect(params.outputGain).toBeGreaterThan(1.0);
    expect(params.sideGain).toBeLessThanOrEqual(1.5);
  });

  test("default width keeps natural stereo gain", () => {
    const params = deriveProcessingParameters({
      dialogueClean: 50,
      musicWeight: 50,
      width: 50,
      ducking: 30,
      loudnessPreset: "clear-balanced",
    });
    expect(params.sideGain).toBeCloseTo(1.0, 5);
  });

  test("batch enrichment receives the accepted preview parameters", () => {
    const controls = {
      dialogueClean: 50,
      musicWeight: 50,
      width: 80,
      ducking: 30,
      loudnessPreset: "clear-balanced" as const,
    };
    const preview = deriveProcessingParameters(controls);
    expect(deriveBatchEnrichmentOptions(controls)).toEqual({
      rumbleCut: true,
      highpassFrequency: preview.highpassFrequency,
      highpassQ: preview.highpassQ,
      presenceFrequency: preview.presenceFrequency,
      presenceDb: preview.presenceGain,
      presenceQ: preview.presenceQ,
      compressorThresholdDb: preview.compressorThreshold,
      compressorRatio: preview.compressorRatio,
      width: preview.sideGain,
      dialogueGain: preview.outputGain,
    });
    expect(preview.presenceQ).toBe(0.8);
  });

  test("supports expected audio/video extensions", () => {
    expect(isLikelySupportedAudioVideoFile(new File(["x"], "talk.mp3"))).toBe(
      true,
    );
    expect(
      isLikelySupportedAudioVideoFile(
        new File(["x"], "image.png", { type: "image/png" }),
      ),
    ).toBe(false);
  });

  test("default preview state starts idle and without source", () => {
    const state = createDefaultState();
    expect(state.status).toBe("idle");
    expect(state.sourceKind).toBe("unknown");
    expect(state.positionSeconds).toBe(0);
  });
});

describe("real media preview controller", () => {
  test("revokes prior object URLs and destroys graph on source replacement", async () => {
    const revoked: string[] = [];
    const created: string[] = [];
    const originalAudioContext = globalThis.AudioContext;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    URL.createObjectURL = ((file: File): string => {
      const value = `blob:${file.name}:${created.length + 1}`;
      created.push(value);
      return value;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((value: string) => {
      revoked.push(value);
    }) as typeof URL.revokeObjectURL;

    const media = new FakeMediaElement();
    FakeAudioContext.instances = [];

    try {
      const controller = createRealMediaPreviewController(
        media as unknown as HTMLMediaElement,
      );
      const first = new File(["one"], "first.mp3");
      const second = new File(["two"], "second.mp4");

      const firstLoad = controller.loadSource(first);
      media.duration = 22;
      media.dispatchEvent({ type: "loadedmetadata" });
      await firstLoad;
      expect(media.muted).toBe(false);
      const sourceGain = FakeAudioContext.instances[0]!.gains[2]!;
      expect(sourceGain.channelCount).toBe(2);
      expect(sourceGain.channelCountMode).toBe("explicit");
      expect(sourceGain.channelInterpretation).toBe("speakers");

      const secondLoad = controller.loadSource(second);
      media.duration = 30;
      media.dispatchEvent({ type: "loadedmetadata" });
      await secondLoad;

      expect(created).toHaveLength(2);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]).toBe(created[0]);

      await controller.play();
      controller.destroy();
    } finally {
      globalThis.AudioContext = originalAudioContext;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
