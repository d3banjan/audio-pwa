#!/usr/bin/env python3
"""Strict official HTDemucs CUDA reference runner with exact 7.8 s chunks."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import soundfile as sf
import torch
import torchaudio
from demucs import __version__ as demucs_version, pretrained
from demucs.apply import apply_model


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="htdemucs")
    args = parser.parse_args()

    if demucs_version != "4.0.1":
        raise RuntimeError(f"Demucs 4.0.1 required, found {demucs_version}")
    if torch.__version__ != "2.1.2+cu121" or torchaudio.__version__ != "2.1.2+cu121":
        raise RuntimeError(f"Pinned torch/torchaudio required, found {torch.__version__}/{torchaudio.__version__}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required; CPU substitution is forbidden")

    audio, sample_rate = torchaudio.load(args.input)
    if sample_rate != 44_100 or audio.shape[0] != 2:
        raise RuntimeError(f"Expected stereo 44.1 kHz input, got {tuple(audio.shape)} at {sample_rate}")
    if not torch.isfinite(audio).all():
        raise RuntimeError("Input contains non-finite samples")

    checkpoint = Path.home() / ".cache/torch/hub/checkpoints/955717e8-8726e21a.th"
    expected_checkpoint_hash = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
    if not checkpoint.is_file() or sha256(checkpoint) != expected_checkpoint_hash:
        raise RuntimeError("Pinned HTDemucs checkpoint is missing or has the wrong hash; automatic download is forbidden")
    model = pretrained.get_model(args.model)
    if model.sources != ["drums", "bass", "other", "vocals"]:
        raise RuntimeError(f"Unexpected stem contract: {model.sources}")
    if model.samplerate != 44_100 or model.audio_channels != 2:
        raise RuntimeError("Unexpected HTDemucs audio contract")
    model.cpu().eval()

    reference = audio.mean(0)
    mean = reference.mean()
    standard_deviation = reference.std()
    if not torch.isfinite(standard_deviation) or standard_deviation <= 0:
        raise RuntimeError("Input normalization is undefined")
    normalized = (audio - mean) / standard_deviation

    started = time.monotonic()
    separated = apply_model(
        model,
        normalized[None],
        device="cuda",
        shifts=0,
        split=True,
        overlap=2.5 / 7.8,
        transition_power=1.0,
        progress=True,
        num_workers=0,
        segment=7.8,
    )[0]
    separated = separated * standard_deviation + mean
    if separated.shape != (4, 2, audio.shape[-1]) or not torch.isfinite(separated).all():
        raise RuntimeError(f"Invalid separated tensor: {tuple(separated.shape)}")

    args.output.mkdir(parents=True, exist_ok=True)
    stem_hashes: dict[str, str] = {}
    for index, stem in enumerate(model.sources):
        path = args.output / f"{stem}.wav"
        sf.write(path, separated[index].numpy().T, 44_100, subtype="FLOAT")
        stem_hashes[stem] = sha256(path)

    checkpoint_root = Path.home() / ".cache/torch/hub/checkpoints"
    checkpoints = {
        path.name: {"sha256": sha256(path), "bytes": path.stat().st_size}
        for path in sorted(checkpoint_root.glob("*.th"))
    }
    reconstruction = separated.sum(0) - audio
    manifest = {
        "stage": "htdemucs-official-pytorch-research-reference",
        "demucs_version": demucs_version,
        "model": args.model,
        "device": torch.cuda.get_device_name(0),
        "sample_rate": sample_rate,
        "channels": 2,
        "frames": audio.shape[-1],
        "segment_seconds": 7.8,
        "overlap_seconds": 2.5,
        "shifts": 0,
        "input_sha256": sha256(args.input),
        "checkpoint_files": checkpoints,
        "stem_sha256": stem_hashes,
        "stem_sum_residual_rms": float(torch.sqrt(torch.mean(reconstruction.square()))),
        "elapsed_seconds": time.monotonic() - started,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
