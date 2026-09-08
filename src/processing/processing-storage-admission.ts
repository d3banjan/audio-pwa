/** Pure storage sizing for the prepared I-013 processing path. */

export const PROCESSING_STORAGE_RESERVE_RATIO = 0.2;
export const PINNED_SILERO_MODEL_BYTES = 1_289_603;
export const PINNED_ORT_WASM_BYTES = 13_961_845;
export const PINNED_ORT_JAVASCRIPT_BYTES = 72_435;
export const PINNED_PROCESSING_ASSET_BYTES =
  PINNED_SILERO_MODEL_BYTES +
  PINNED_ORT_WASM_BYTES +
  PINNED_ORT_JAVASCRIPT_BYTES;

const PROCESSED_STEREO_FLOAT32_BYTES_PER_FRAME = 2 * 4;
const PCM24_STEREO_BYTES_PER_FRAME = 2 * 3;
const WAV_HEADER_BYTES = 44;

export type ProcessingStorageRequirement = Readonly<{
  canonicalFrames: number;
  processedPcmBytes: number;
  wavBytes: number;
  assetAllowanceBytes: number;
  reserveBytes: number;
  requiredBytes: number;
}>;

export type ProcessingStorageAdmission = ProcessingStorageRequirement &
  Readonly<{
    status: "admitted" | "unavailable" | "insufficient";
    quotaBytes?: number;
    usageBytes?: number;
    availableBytes?: number;
    deficitBytes: number;
  }>;

function assertByteCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`);
}

export function estimateProcessingStorage(
  canonicalFrames: number,
): ProcessingStorageRequirement {
  assertByteCount(canonicalFrames, "canonicalFrames");
  const processedPcmBytes =
    canonicalFrames * PROCESSED_STEREO_FLOAT32_BYTES_PER_FRAME;
  const wavBytes =
    WAV_HEADER_BYTES + canonicalFrames * PCM24_STEREO_BYTES_PER_FRAME;
  const baseBytes =
    processedPcmBytes + wavBytes + PINNED_PROCESSING_ASSET_BYTES;
  const reserveBytes = Math.ceil(baseBytes * PROCESSING_STORAGE_RESERVE_RATIO);
  const requiredBytes = baseBytes + reserveBytes;
  for (const [name, value] of Object.entries({
    processedPcmBytes,
    wavBytes,
    baseBytes,
    reserveBytes,
    requiredBytes,
  }))
    assertByteCount(value, name);
  return Object.freeze({
    canonicalFrames,
    processedPcmBytes,
    wavBytes,
    assetAllowanceBytes: PINNED_PROCESSING_ASSET_BYTES,
    reserveBytes,
    requiredBytes,
  });
}

export function admitProcessingStorage(
  canonicalFrames: number,
  estimate: Readonly<{ quota?: number; usage?: number }> | undefined,
): ProcessingStorageAdmission {
  const requirement = estimateProcessingStorage(canonicalFrames);
  const quotaBytes = estimate?.quota;
  const usageBytes = estimate?.usage;
  if (
    typeof quotaBytes !== "number" ||
    !Number.isSafeInteger(quotaBytes) ||
    quotaBytes <= 0 ||
    typeof usageBytes !== "number" ||
    !Number.isSafeInteger(usageBytes) ||
    usageBytes < 0 ||
    usageBytes > quotaBytes
  )
    return Object.freeze({
      ...requirement,
      status: "unavailable",
      deficitBytes: requirement.requiredBytes,
    });

  const availableBytes = quotaBytes - usageBytes;
  return Object.freeze({
    ...requirement,
    status:
      availableBytes >= requirement.requiredBytes ? "admitted" : "insufficient",
    quotaBytes,
    usageBytes,
    availableBytes,
    deficitBytes: Math.max(0, requirement.requiredBytes - availableBytes),
  });
}
