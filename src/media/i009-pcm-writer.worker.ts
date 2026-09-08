type WriteMessage = {
  type: "page";
  generation: number;
  runId: string;
  index: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
  validFrames: number;
};

const checksum = (buffer: ArrayBuffer, bytes: number): string => {
  let value = 0x811c9dc5;
  const values = new Uint8Array(buffer, 0, bytes);
  for (const byte of values) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
};

const writePage = async (message: WriteMessage) => {
  const byteLength = message.validFrames * Float32Array.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(message.validFrames) ||
    message.validFrames <= 0 ||
    byteLength > message.left.byteLength ||
    byteLength > message.right.byteLength
  )
    throw new Error("Writer received an invalid PCM page.");
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(message.runId, { create: true });
  const file = await dir.getFileHandle(
    `page-${message.index.toString().padStart(6, "0")}.pcm`,
    { create: true },
  );
  // createWritable keeps the replacement private until close; the committed
  // manifest is the only reader-visible publication point for this staging run.
  const writable = await file.createWritable();
  await writable.write(new Uint8Array(message.left, 0, byteLength));
  await writable.write(new Uint8Array(message.right, 0, byteLength));
  await writable.close();
  self.postMessage(
    {
      type: "ack",
      generation: message.generation,
      runId: message.runId,
      index: message.index,
      left: message.left,
      right: message.right,
      validFrames: message.validFrames,
      integrity: `${checksum(message.left, byteLength)}:${checksum(message.right, byteLength)}`,
    },
    [message.left, message.right],
  );
};

let queue = Promise.resolve();
let failed = false;
self.onmessage = (event: MessageEvent<WriteMessage>) => {
  if (failed || event.data.type !== "page") return;
  queue = queue
    .then(() => writePage(event.data))
    .catch((cause) => {
      failed = true;
      self.postMessage({
        type: "error",
        generation: event.data.generation,
        runId: event.data.runId,
        message:
          cause instanceof Error ? cause.message : "Audio cache write failed.",
      });
    });
};
