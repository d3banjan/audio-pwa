#!/usr/bin/env python3
"""Strict downstream stages for the native AI research-reference pipeline."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio
from df.enhance import enhance, init_df

RATE = 48_000
SILERO_RATE = 16_000
SILERO_FRAME = 512
CANONICAL_FRAME = 1_536
SILERO_CONTEXT = 64


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_stereo(path: Path, expected_rate: int) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    if rate != expected_rate or audio.shape[1] != 2 or not np.isfinite(audio).all():
        raise RuntimeError(f"Invalid stereo audio contract for {path}: {audio.shape} at {rate}")
    return audio


def write_float(path: Path, audio: np.ndarray) -> None:
    if audio.ndim != 2 or audio.shape[1] != 2 or not np.isfinite(audio).all():
        raise RuntimeError(f"Refusing to write invalid audio: {path}")
    sf.write(path, audio, RATE, subtype="FLOAT")


def resample(audio: np.ndarray, source_rate: int, frames: int) -> np.ndarray:
    tensor = torch.from_numpy(audio.T)
    result = torchaudio.functional.resample(tensor, source_rate, RATE).T.numpy()
    if len(result) < frames:
        result = np.pad(result, ((0, frames - len(result)), (0, 0)))
    return result[:frames].astype(np.float32, copy=False)


def moving_rms(signal: np.ndarray, samples: int) -> np.ndarray:
    cumulative = np.concatenate(([0.0], np.cumsum(signal.astype(np.float64) ** 2)))
    valid = np.sqrt(np.maximum((cumulative[samples:] - cumulative[:-samples]) / samples, 1e-20))
    return np.pad(valid, (samples - 1, 0), mode="edge").astype(np.float32)


def split_other(other: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """Provisional linked-stereo complementary envelope masks."""
    # LEAKY ABSTRACTION(I-014): These masks preserve and partition the `other`
    # stem, but envelope shape cannot establish music/ambience/SFX semantics.
    # Replace this entire function at the Stage 2 quality gate described in the
    # I-014 wiki package; do not tune its constants into a claimed classifier.
    mono = other.mean(axis=1)
    short = moving_rms(mono, round(RATE * 0.005))
    long = moving_rms(mono, round(RATE * 0.100))
    ratio = short / (long + 1e-7)
    transient = np.clip((ratio - 1.0) / (2.2 - 1.0), 0.0, 1.0)
    reference = max(float(np.percentile(long, 85)), 1e-5)
    activity = np.clip(long / reference, 0.0, 1.0)
    ambience = (1.0 - transient) * (1.0 - 0.75 * activity)
    harmonic = np.maximum(0.0, 1.0 - transient - ambience)
    total = harmonic + ambience + transient
    harmonic /= total
    ambience /= total
    transient /= total
    sum_error = float(np.max(np.abs(harmonic + ambience + transient - 1.0)))
    return (
        other * harmonic[:, None],
        other * ambience[:, None],
        other * transient[:, None],
        sum_error,
    )


def clean_dialogue(vocals: np.ndarray) -> tuple[np.ndarray, dict]:
    deepfilter_root = Path.home() / ".cache/DeepFilterNet/DeepFilterNet3"
    expected = {
        deepfilter_root / "config.ini": "415eb925d44990d938fb739f514aa3662c1ec0ea836cff044fa1291b82cb4290",
        deepfilter_root / "checkpoints/model_120.ckpt.best": "23b92884f63ccf54bb026014604625ab231657b6480df65db4095c4c171e6003",
    }
    if any(not path.is_file() or sha256(path) != digest for path, digest in expected.items()):
        raise RuntimeError("Pinned DeepFilterNet3 model is missing or has the wrong hash; automatic download is forbidden")
    model, state, model_name = init_df(log_file=None, log_level="ERROR", default_model="DeepFilterNet3")
    device = next(model.parameters()).device
    if device.type != "cuda":
        raise RuntimeError(f"DeepFilterNet must use CUDA, got {device}")
    if state.sr() != RATE or state.fft_size() != 960 or state.hop_size() != 480:
        raise RuntimeError("Unexpected DeepFilterNet3 audio/delay contract")
    frames = len(vocals)
    chunk = 30 * RATE
    overlap = 1 * RATE
    hop = chunk - overlap
    output = np.zeros_like(vocals, dtype=np.float32)
    weights = np.zeros(frames, dtype=np.float32)
    starts = list(range(0, frames, hop))
    for index, start in enumerate(starts):
        end = min(start + chunk, frames)
        block = torch.from_numpy(vocals[start:end].T.copy())
        cleaned = enhance(model, state, block, pad=True).T.numpy().astype(np.float32)
        if cleaned.shape != vocals[start:end].shape or not np.isfinite(cleaned).all():
            raise RuntimeError(f"DeepFilterNet returned invalid chunk {index}")
        weight = np.ones(end - start, dtype=np.float32)
        fade = min(overlap, end - start)
        if start > 0:
            weight[:fade] = np.linspace(0, 1, fade, endpoint=False, dtype=np.float32)
        if end < frames:
            weight[-fade:] = np.minimum(weight[-fade:], np.linspace(1, 0, fade, endpoint=False, dtype=np.float32))
        output[start:end] += cleaned * weight[:, None]
        weights[start:end] += weight
        del block, cleaned
        torch.cuda.empty_cache()
    if np.any(weights <= 0):
        raise RuntimeError("DeepFilterNet overlap-add left uncovered samples")
    output /= weights[:, None]
    return output, {
        "model": model_name,
        "package_version": importlib.metadata.version("deepfilternet"),
        "device": str(device),
        "sample_rate": state.sr(),
        "fft_size": state.fft_size(),
        "hop_size": state.hop_size(),
        "compensated_algorithmic_delay_samples": state.fft_size() - state.hop_size(),
        "chunk_seconds": 30,
        "overlap_seconds": 1,
    }


def silero_coefficients() -> np.ndarray:
    taps = 63
    midpoint = (taps - 1) / 2
    indexes = np.arange(taps)
    offsets = indexes - midpoint
    ideal = 0.3 * np.sinc(0.3 * offsets)
    hamming = 0.54 - 0.46 * np.cos(2 * np.pi * indexes / (taps - 1))
    coefficients = ideal * hamming
    return (coefficients / coefficients.sum()).astype(np.float64)


def vad_probabilities(vocals: np.ndarray, model_path: Path) -> np.ndarray:
    if sha256(model_path) != "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49":
        raise RuntimeError("Silero v6.2.1 artifact hash mismatch")
    mono = vocals.mean(axis=1).astype(np.float64)
    filtered = np.convolve(mono, silero_coefficients(), mode="full")[: len(mono)]
    downsampled = filtered[::3].astype(np.float32)
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    if session.get_providers() != ["CPUExecutionProvider"]:
        raise RuntimeError(f"Unexpected Silero provider: {session.get_providers()}")
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros(SILERO_CONTEXT, dtype=np.float32)
    probabilities = []
    for start in range(0, len(downsampled), SILERO_FRAME):
        frame = downsampled[start : start + SILERO_FRAME]
        if len(frame) < SILERO_FRAME:
            frame = np.pad(frame, (0, SILERO_FRAME - len(frame)))
        result = session.run(None, {
            "input": np.concatenate((context, frame))[None, :],
            "state": state,
            "sr": np.asarray(16_000, dtype=np.int64),
        })
        probability = float(np.asarray(result[0]).reshape(-1)[0])
        state = np.asarray(result[1], dtype=np.float32)
        if not 0 <= probability <= 1 or state.shape != (2, 1, 128):
            raise RuntimeError("Silero returned an invalid output")
        probabilities.append(probability)
        context = frame[-SILERO_CONTEXT:].copy()
    return np.asarray(probabilities, dtype=np.float32)


def postprocess_activity(probabilities: np.ndarray) -> np.ndarray:
    active = probabilities >= 0.5
    minimum = math.ceil(0.250 / (SILERO_FRAME / SILERO_RATE))
    merge_gap = math.floor(0.300 / (SILERO_FRAME / SILERO_RATE))
    index = 0
    while index < len(active):
        if not active[index]:
            index += 1
            continue
        end = index
        while end < len(active) and active[end]:
            end += 1
        if end - index < minimum:
            active[index:end] = False
        index = end
    index = 0
    while index < len(active):
        if active[index]:
            index += 1
            continue
        end = index
        while end < len(active) and not active[end]:
            end += 1
        if index > 0 and end < len(active) and end - index <= merge_gap:
            active[index:end] = True
        index = end
    return active


def duck_curve(active: np.ndarray, frames: int) -> np.ndarray:
    mask = np.repeat(active.astype(np.float32), CANONICAL_FRAME)[:frames]
    if len(mask) < frames:
        mask = np.pad(mask, (0, frames - len(mask)))
    # Account for the causal decimator's 31-frame delay and 20 ms lookahead.
    advance = 31 + round(0.020 * RATE)
    mask = np.pad(mask, (0, advance))[advance : advance + frames]
    frame_hop = 240  # 5 ms control rate
    targets = 1.0 - (1.0 - 10 ** (-6 / 20)) * mask[::frame_hop]
    smoothed = np.empty_like(targets)
    value = 1.0
    for index, target in enumerate(targets):
        tau = 0.040 if target < value else 0.250
        coefficient = 1.0 - math.exp(-(frame_hop / RATE) / tau)
        value += coefficient * (float(target) - value)
        smoothed[index] = value
    positions = np.arange(len(smoothed)) * frame_hop
    return np.interp(np.arange(frames), positions, smoothed, right=smoothed[-1]).astype(np.float32)


def stereo_width(audio: np.ndarray, width: float) -> np.ndarray:
    mid = (audio[:, 0] + audio[:, 1]) * 0.5
    side = (audio[:, 0] - audio[:, 1]) * 0.5 * width
    return np.column_stack((mid + side, mid - side)).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stems", type=Path)
    parser.add_argument("silero", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if importlib.metadata.version("deepfilternet") != "0.5.6":
        raise RuntimeError("DeepFilterNet 0.5.6 is required")
    if importlib.metadata.version("onnxruntime") != "1.23.2":
        raise RuntimeError("ONNX Runtime 1.23.2 is required")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required; CPU substitution is forbidden")
    started = time.monotonic()
    stems_44 = {name: read_stereo(args.stems / f"{name}.wav", 44_100) for name in ("vocals", "drums", "bass", "other")}
    source_frames = len(stems_44["vocals"])
    if any(len(stem) != source_frames for stem in stems_44.values()):
        raise RuntimeError("HTDemucs stems do not share an exact timeline")
    target_frames = round(source_frames * RATE / 44_100)
    stems = {name: resample(stem, 44_100, target_frames) for name, stem in stems_44.items()}
    del stems_44

    cleaned, deepfilter_contract = clean_dialogue(stems["vocals"])
    harmonic, ambience, effects, mask_error = split_other(stems["other"])
    if mask_error > 2e-6 or float(np.max(np.abs(harmonic + ambience + effects - stems["other"]))) > 2e-6:
        raise RuntimeError("Stage 2 complementary masks failed reconstruction")
    probabilities = vad_probabilities(stems["vocals"], args.silero)
    active = postprocess_activity(probabilities)
    duck = duck_curve(active, target_frames)

    dialogue = 0.55 * stems["vocals"] + 0.45 * cleaned
    dialogue_tensor = torch.from_numpy(dialogue.T.copy()).cuda()
    dialogue_tensor = torchaudio.functional.highpass_biquad(dialogue_tensor, RATE, 80, 0.707)
    dialogue_tensor = torchaudio.functional.equalizer_biquad(dialogue_tensor, RATE, 3_500, 2.5, 1.2)
    dialogue = dialogue_tensor.cpu().T.numpy().astype(np.float32)
    del dialogue_tensor
    music = stereo_width(stems["drums"] + stems["bass"] + harmonic, 1.3)
    ambience = stereo_width(ambience, 1.3)
    music *= duck[:, None]
    ambience *= duck[:, None]
    mix = dialogue + music + ambience + effects
    peak = float(np.max(np.abs(mix)))
    safety_gain = min(1.0, 10 ** (-3 / 20) / max(peak, 1e-12))
    mix *= safety_gain
    for audio in (dialogue, music, ambience, effects, mix):
        if len(audio) != target_frames or not np.isfinite(audio).all():
            raise RuntimeError("A routed output violated the canonical timeline")

    args.output.mkdir(parents=True, exist_ok=True)
    outputs = {"dialogue": dialogue, "music": music, "ambience": ambience, "sfx": effects, "premaster": mix}
    for name, audio in outputs.items():
        write_float(args.output / f"{name}.wav", audio)
    np.save(args.output / "vad-probabilities.npy", probabilities)
    np.save(args.output / "vad-active.npy", active)

    deepfilter_root = Path.home() / ".cache/DeepFilterNet/DeepFilterNet3"
    manifest = {
        "pipeline": "native-cuda-full-topology-research-reference-v1",
        "qualification": "research-reference-not-browser-qualified",
        "sample_rate": RATE,
        "channels": 2,
        "frames": target_frames,
        "duration_seconds": target_frames / RATE,
        "deepfilternet": {
            **deepfilter_contract,
            "config_sha256": sha256(deepfilter_root / "config.ini"),
            "checkpoint_sha256": sha256(deepfilter_root / "checkpoints/model_120.ckpt.best"),
        },
        "silero": {
            "release": "6.2.1",
            "artifact_sha256": sha256(args.silero),
            "provider": "CPUExecutionProvider (explicit, not fallback)",
            "frame_samples": SILERO_FRAME,
            "threshold": 0.5,
            "probability_frames": len(probabilities),
            "active_frames": int(active.sum()),
            "decimator_group_delay_canonical_frames": 31,
        },
        "stage2": {"algorithm": "provisional-linked-envelope-complementary-v1", "mask_sum_error": mask_error},
        "routing": {"dialogue_clean_wet": 0.45, "stereo_width": 1.3, "duck_db": -6, "duck_attack_ms": 40, "duck_release_ms": 250, "duck_lookahead_ms": 20},
        "premaster": {"pre_safety_peak": peak, "common_safety_gain": safety_gain, "ceiling_dbfs": -3},
        "outputs": {name: {"sha256": sha256(args.output / f"{name}.wav"), "bytes": (args.output / f"{name}.wav").stat().st_size} for name in outputs},
        "elapsed_seconds": time.monotonic() - started,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
