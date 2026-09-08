/** Pure sizing and admission calculations for bounded audio processing. */

export type PcmLayout = Readonly<{
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
}>;

export type MemoryReservations = Readonly<{
  modelBytes: number;
  decoderBytes: number;
  playbackBytes: number;
  uiBytes: number;
  safetyMarginBytes: number;
}>;

export type MemoryAdmissionRequest = Readonly<{
  budgetBytes: number;
  durationSeconds: number;
  residentAudioAssetCount: number;
  layout?: PcmLayout;
  reservations: MemoryReservations;
}>;

export type MemoryAdmissionResult = Readonly<{
  admitted: boolean;
  budgetBytes: number;
  audioBytes: number;
  reservedBytes: number;
  requiredBytes: number;
  deficitBytes: number;
}>;

export type StorageRequirementRequest = Readonly<{
  projectAssetBytes: number;
  modelBytes: number;
  temporaryOverlapBytes: number;
  exportBytes: number;
  reserveRatio?: number;
}>;

export type StorageRequirementResult = Readonly<{
  baseBytes: number;
  reserveBytes: number;
  requiredBytes: number;
}>;

export const CANONICAL_PCM_LAYOUT: PcmLayout = Object.freeze({
  sampleRate: 48_000,
  channels: 2,
  bytesPerSample: 4,
});

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertByteCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative safe integer byte count`,
    );
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertLayout(layout: PcmLayout): void {
  assertPositiveInteger(layout.sampleRate, "layout.sampleRate");
  assertPositiveInteger(layout.channels, "layout.channels");
  assertPositiveInteger(layout.bytesPerSample, "layout.bytesPerSample");
}

/** Number of PCM bytes for a duration, rounded up to retain the final frame. */
export function estimatePcmBytes(
  durationSeconds: number,
  layout: PcmLayout = CANONICAL_PCM_LAYOUT,
): number {
  assertNonNegativeFinite(durationSeconds, "durationSeconds");
  assertLayout(layout);

  const frames = Math.ceil(durationSeconds * layout.sampleRate);
  const bytes = frames * layout.channels * layout.bytesPerSample;
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError("PCM byte estimate is outside the safe integer range");
  }
  return bytes;
}

export function estimateResidentAudioBytes(
  durationSeconds: number,
  residentAudioAssetCount: number,
  layout: PcmLayout = CANONICAL_PCM_LAYOUT,
): number {
  assertPositiveInteger(residentAudioAssetCount, "residentAudioAssetCount");
  const bytes =
    estimatePcmBytes(durationSeconds, layout) * residentAudioAssetCount;
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError(
      "resident audio byte estimate is outside the safe integer range",
    );
  }
  return bytes;
}

function sumReservations(reservations: MemoryReservations): number {
  const values = Object.values(reservations);
  values.forEach((value, index) =>
    assertByteCount(value, `reservations[${index}]`),
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(
      "memory reservation is outside the safe integer range",
    );
  }
  return total;
}

/**
 * Admit a processing plan only when all resident audio plus opaque runtime
 * reservations fit under the configured budget.
 */
export function assessMemoryAdmission(
  request: MemoryAdmissionRequest,
): MemoryAdmissionResult {
  assertPositiveInteger(request.budgetBytes, "budgetBytes");
  const audioBytes = estimateResidentAudioBytes(
    request.durationSeconds,
    request.residentAudioAssetCount,
    request.layout,
  );
  const reservedBytes = sumReservations(request.reservations);
  const requiredBytes = audioBytes + reservedBytes;
  if (!Number.isSafeInteger(requiredBytes)) {
    throw new RangeError("required memory is outside the safe integer range");
  }
  return Object.freeze({
    admitted: requiredBytes <= request.budgetBytes,
    budgetBytes: request.budgetBytes,
    audioBytes,
    reservedBytes,
    requiredBytes,
    deficitBytes: Math.max(0, requiredBytes - request.budgetBytes),
  });
}

/** Include a clear reserve when checking OPFS/project storage admission. */
export function estimateStorageRequirement(
  request: StorageRequirementRequest,
): StorageRequirementResult {
  const byteFields = [
    ["projectAssetBytes", request.projectAssetBytes],
    ["modelBytes", request.modelBytes],
    ["temporaryOverlapBytes", request.temporaryOverlapBytes],
    ["exportBytes", request.exportBytes],
  ] as const;
  byteFields.forEach(([name, value]) => assertByteCount(value, name));

  const reserveRatio = request.reserveRatio ?? 0.2;
  if (!Number.isFinite(reserveRatio) || reserveRatio < 0 || reserveRatio > 1) {
    throw new RangeError("reserveRatio must be between 0 and 1");
  }
  const baseBytes = byteFields.reduce((sum, [, value]) => sum + value, 0);
  const reserveBytes = Math.ceil(baseBytes * reserveRatio);
  const requiredBytes = baseBytes + reserveBytes;
  if (!Number.isSafeInteger(requiredBytes)) {
    throw new RangeError(
      "storage requirement is outside the safe integer range",
    );
  }
  return Object.freeze({ baseBytes, reserveBytes, requiredBytes });
}
