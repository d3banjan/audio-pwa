declare const registerProcessor: (name: string, processor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const PAGE_FRAMES = 240000;
const POOL_SIZE = 4;

type Page = { left: Float32Array; right: Float32Array };

/**
 * The processor owns exactly four page pairs. It never allocates from process():
 * ownership moves to the writer and returns only through the recycle message.
 */
class I009PcmProcessor extends AudioWorkletProcessor {
  private free: Page[] = [];
  private current: Page | undefined;
  private offset = 0;
  private cancelled = false;
  private waiting = false;
  private reportedFailure = false;
  private readonly targetFrames: number;
  private observedFrames = 0;
  private retainedFrames = 0;
  private tailTrimmedFrames = 0;

  constructor(options?: { processorOptions?: { targetFrames?: unknown } }) {
    super();
    const targetFrames = options?.processorOptions?.targetFrames;
    this.targetFrames =
      typeof targetFrames === "number" &&
      Number.isSafeInteger(targetFrames) &&
      targetFrames > 0
        ? targetFrames
        : 0;
    for (let index = 0; index < POOL_SIZE; index++) {
      this.free.push({
        left: new Float32Array(PAGE_FRAMES),
        right: new Float32Array(PAGE_FRAMES),
      });
    }
    this.current = this.free.pop();
    this.port.onmessage = ({
      data,
    }: MessageEvent<{
      type: string;
      left?: ArrayBuffer;
      right?: ArrayBuffer;
    }>) => {
      if (data?.type === "cancel") {
        this.cancelled = true;
        this.current = undefined;
        this.free = [];
        return;
      }
      if (
        data?.type === "recycle" &&
        data.left &&
        data.right &&
        !this.cancelled
      ) {
        this.free.push({
          left: new Float32Array(data.left),
          right: new Float32Array(data.right),
        });
        if (!this.current) {
          this.current = this.free.pop();
          this.offset = 0;
          this.waiting = false;
        }
        return;
      }
      if (data?.type === "flush" && !this.cancelled) this.flush(true);
    };
  }

  private fail(type: "overrun" | "unsupported-channel-count") {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    this.port.postMessage({ type });
  }

  private flush(eof = false) {
    if (!this.current || this.offset === 0) {
      if (eof) this.reportFlushed();
      return;
    }
    const page = this.current;
    const validFrames = this.offset;
    this.current = this.free.pop();
    this.offset = 0;
    this.port.postMessage(
      {
        type: "page",
        left: page.left.buffer,
        right: page.right.buffer,
        validFrames,
      },
      [page.left.buffer, page.right.buffer],
    );
    if (!this.current) this.waiting = true;
    if (eof) this.reportFlushed();
  }

  private reportFlushed() {
    this.port.postMessage({
      type: "flushed",
      observedFrames: this.observedFrames,
      retainedFrames: this.retainedFrames,
      tailTrimmedFrames: this.tailTrimmedFrames,
    });
  }

  process(inputs: Float32Array[][]) {
    if (this.cancelled) return false;
    const channels = inputs[0];
    if (!channels) return true;
    if (channels.length > 2) {
      this.fail("unsupported-channel-count");
      return false;
    }
    const left = channels[0];
    if (!left) return true;
    this.observedFrames += left.length;
    const retainCount = Math.max(
      0,
      Math.min(left.length, this.targetFrames - this.retainedFrames),
    );
    this.tailTrimmedFrames += left.length - retainCount;
    if (retainCount === 0) return true;
    if (!this.current || this.waiting) {
      // A render quantum arrived after main-thread pause and before capacity
      // returned. Reporting this is safer than silently discarding PCM.
      this.fail("overrun");
      return false;
    }
    const right = channels[1] ?? left;
    for (let index = 0; index < retainCount; index++) {
      if (this.offset === PAGE_FRAMES) this.flush();
      if (!this.current || this.waiting) {
        this.fail("overrun");
        return false;
      }
      this.current.left[this.offset] = left[index] ?? 0;
      this.current.right[this.offset] = right[index] ?? 0;
      this.offset++;
      this.retainedFrames++;
    }
    return true;
  }
}

registerProcessor("i009-native-pcm", I009PcmProcessor);
