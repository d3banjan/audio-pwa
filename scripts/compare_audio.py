#!/usr/bin/env python3
"""Find where a processed track differs most from its source.

Examples:
  python3 scripts/compare_audio.py original.webm processed.webm
  python3 scripts/compare_audio.py original.webm processed.wav --render artifacts/compare.mp4

Both inputs are decoded from the beginning through ffmpeg. This is deliberate:
some browser-recorded WebM files have unusable seek timestamps. Scores compare
centered, RMS-normalized samples, so a gain change alone scores near zero.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np


def decode(path: Path, rate: int) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(rate), "-f", "f32le", "pipe:1"]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f"Could not decode {path} with ffmpeg") from exc
    samples = np.frombuffer(result.stdout, dtype="<f4").astype(np.float32)
    if len(samples) < rate // 10:
        raise ValueError(f"Decoded audio is empty or too short: {path}")
    if not np.isfinite(samples).all():
        raise ValueError(f"Decoded audio contains non-finite samples: {path}")
    return samples


def align(source: np.ndarray, processed: np.ndarray, rate: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Align streams using a coarse sequential correlation and report confidence."""
    length = min(len(source), len(processed))
    if length < rate:
        raise ValueError("Need at least one second of overlapping audio to align")
    stride = max(1, rate // 100)
    usable = length - length % stride
    # Energy envelopes survive EQ, compression, and denoising better than
    # sample-for-sample waveform correlation and are suitable for sync checks.
    a = np.mean(np.abs(source[:usable].reshape(-1, stride)), axis=1)
    b = np.mean(np.abs(processed[:usable].reshape(-1, stride)), axis=1)
    a, b = normalized(a), normalized(b)
    limit = min(len(a) // 4, 100)
    correlations = []
    for lag in range(-limit, limit + 1):
        if lag < 0:
            x, y = a[-lag:], b[:len(b) + lag]
        elif lag > 0:
            x, y = a[:-lag], b[lag:]
        else:
            x, y = a, b
        correlations.append((float(np.dot(x, y) / max(len(x), 1)), lag))
    confidence, lag = max(correlations, key=lambda item: item[0])
    if confidence < 0.50:
        raise ValueError(f"Could not establish alignment confidence (correlation={confidence:.3f})")
    sample_lag = lag * stride
    if sample_lag < 0:
        source, processed = source[-sample_lag:], processed
    elif sample_lag > 0:
        source, processed = source, processed[sample_lag:]
    length = min(len(source), len(processed))
    return source[:length], processed[:length], confidence


def normalized(x: np.ndarray) -> np.ndarray:
    x = x - float(np.mean(x))
    scale = float(np.sqrt(np.mean(x * x)))
    return x / scale if scale > 1e-8 else np.zeros_like(x)


def score_window(source: np.ndarray, processed: np.ndarray, rate: int) -> dict[str, float]:
    """Perceptual-shape difference after removing whole-window gain."""
    a, b = normalized(source), normalized(processed)
    rms_db = 20 * np.log10(max(float(np.sqrt(np.mean(source * source))), 1e-12))
    processed_rms_db = 20 * np.log10(max(float(np.sqrt(np.mean(processed * processed))), 1e-12))

    # Broad spectral bands are deliberately phase-insensitive. Whole-window RMS
    # normalization makes a pure gain change score approximately zero.
    window = np.hanning(len(a))
    source_power = np.abs(np.fft.rfft(a * window)) ** 2
    processed_power = np.abs(np.fft.rfft(b * window)) ** 2
    meaningful_power = max(float(source_power.sum()), float(processed_power.sum())) * 1e-8
    frequencies = np.fft.rfftfreq(len(a), 1 / rate)
    band_edges = (40, 80, 160, 315, 630, 1_250, 2_500, 5_000, 10_000, 20_000)
    band_changes = []
    for low, high in zip(band_edges, band_edges[1:]):
        mask = (frequencies >= low) & (frequencies < min(high, rate / 2))
        if not np.any(mask):
            continue
        before = float(np.sum(source_power[mask]))
        after = float(np.sum(processed_power[mask]))
        if max(before, after) < meaningful_power:
            continue
        band_changes.append(abs(10 * np.log10((after + 1e-20) / (before + 1e-20))))
    spectral_db = float(np.mean(np.clip(band_changes, 0, 18)))

    # A 50 ms envelope captures compression and other dynamic reshaping while
    # remaining insensitive to waveform phase and codec delay.
    frame = max(1, round(rate * 0.05))
    usable = len(a) - len(a) % frame
    source_envelope = np.sqrt(np.mean(a[:usable].reshape(-1, frame) ** 2, axis=1) + 1e-20)
    processed_envelope = np.sqrt(np.mean(b[:usable].reshape(-1, frame) ** 2, axis=1) + 1e-20)
    audible = np.maximum(source_envelope, processed_envelope) >= 0.1
    dynamic_db = float(
        np.mean(
            np.abs(
                np.clip(
                    20 * np.log10(
                        (processed_envelope[audible] + 1e-10)
                        / (source_envelope[audible] + 1e-10)
                    ),
                    -18,
                    18,
                )
            )
        )
    ) if np.any(audible) else 0.0
    return {
        "score": spectral_db + 0.5 * dynamic_db,
        "spectral_db": spectral_db,
        "dynamic_db": dynamic_db,
        "source_rms_db": rms_db,
        "processed_gain_db_for_level_match": rms_db - processed_rms_db,
    }


def find_segments(source: np.ndarray, processed: np.ndarray, rate: int, window: float, count: int, separation: float, min_rms_db: float) -> list[dict]:
    length = min(len(source), len(processed))
    size = max(1, round(window * rate))
    candidates = []
    # Skip one window at each file edge, where recorder startup/shutdown fades
    # can dominate the comparison without representing a useful scene.
    for start in range(size, max(size, length - size), size // 4 or 1):
        end = start + size
        if end > length:
            break
        metrics = score_window(source[start:end], processed[start:end], rate)
        if metrics["source_rms_db"] >= min_rms_db:
            candidates.append((metrics["score"], start, metrics))
    selected = []
    min_gap = max(0, round(separation * rate))
    for score, start, metrics in sorted(candidates, reverse=True):
        if all(abs(start - prior["start_sample"]) >= min_gap for prior in selected):
            selected.append({"start": start / rate, "end": (start + size) / rate, "start_sample": start, **metrics})
            if len(selected) == count:
                break
    for item in selected:
        item.pop("start_sample")
    if len(selected) != count:
        raise ValueError(f"Found only {len(selected)} qualifying segments; required {count}")
    return sorted(selected, key=lambda item: item["start"])


def render(source_path: Path, processed: np.ndarray, rate: int, segments: list[dict], output: Path) -> None:
    """Render original and processed audio for each source-video scene."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(source_path)], stdout=subprocess.PIPE, check=True)
    if not probe.stdout.strip():
        raise ValueError("--render requires the original input to contain a video stream")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="audio-compare-", dir=output.parent) as temp:
        temp_path = Path(temp) / "processed.f32.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0", "-c:a", "pcm_s16le", str(temp_path)], input=processed.tobytes(), check=True)
        clips = []
        for index, segment in enumerate(segments):
            for label, audio in (("ORIGINAL", source_path), ("PROCESSED", temp_path)):
                clip = Path(temp) / f"{index:02d}-{label}.mp4"
                audio_start = segment["start"] if label == "ORIGINAL" else segment["start"]
                level_gain = 1.0 if label == "ORIGINAL" else 10 ** (segment["processed_gain_db_for_level_match"] / 20)
                subprocess.run([
                    "ffmpeg", "-v", "error", "-i", str(source_path), "-i", str(audio),
                    "-filter_complex",
                    f"[0:v]trim=start={segment['start']}:end={segment['end']},setpts=PTS-STARTPTS,"
                    f"drawbox=x=28:y=28:w={'190' if label == 'ORIGINAL' else '220'}:h=60:"
                    f"color={'black@0.72' if label == 'ORIGINAL' else '0x507f68@0.90'}:t=fill,"
                    f"drawtext=text='{label}':x=48:y=43:fontsize=28:fontcolor=white[v];"
                    f"[1:a]atrim=start={audio_start}:end={audio_start + segment['end'] - segment['start']},volume={level_gain},"
                    "asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,"
                    f"afade=t=out:st={segment['end'] - segment['start'] - 0.02}:d=0.02[a]",
                    "-map", "[v]", "-map", "[a]", "-ac", "2", "-ar", str(rate),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "160k", "-shortest", str(clip)
                ], check=True)
                clips.append(clip)
        concat = Path(temp) / "concat.txt"
        concat.write_text("".join(f"file '{clip}'\n" for clip in clips))
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary_output = Path(temp) / "portfolio.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-af", "aresample=async=1:first_pts=0",
            "-movflags", "+faststart", str(temporary_output)
        ], check=True)
        check = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(temporary_output)], stdout=subprocess.PIPE, check=True)
        metadata = json.loads(check.stdout)
        stream_types = {stream["codec_type"] for stream in metadata.get("streams", [])}
        duration = float(metadata.get("format", {}).get("duration", 0))
        expected = sum(segment["end"] - segment["start"] for segment in segments) * 2
        if stream_types != {"audio", "video"} or abs(duration - expected) > 0.25:
            raise RuntimeError(f"Rendered portfolio failed verification (streams={stream_types}, duration={duration:.3f}, expected={expected:.3f})")
        temporary_output.replace(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("original", type=Path)
    parser.add_argument("processed", type=Path)
    parser.add_argument("--rate", type=int, default=48000)
    parser.add_argument("--window", type=float, default=4.0)
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--separation", type=float, default=8.0)
    parser.add_argument("--min-rms-db", type=float, default=-38.0)
    parser.add_argument("--render", type=Path)
    args = parser.parse_args()
    source, processed = decode(args.original, args.rate), decode(args.processed, args.rate)
    source, processed, alignment_confidence = align(source, processed, args.rate)
    segments = find_segments(source, processed, args.rate, args.window, args.count, args.separation, args.min_rms_db)
    if not segments:
        raise ValueError("No complete scoring windows fit in the decoded overlap")
    result = {"original": str(args.original), "processed": str(args.processed), "sample_rate": args.rate, "duration": len(source) / args.rate, "alignment_confidence": alignment_confidence, "segments": segments}
    print(json.dumps(result, indent=2))
    if args.render:
        render(args.original, processed, args.rate, segments, args.render)


if __name__ == "__main__":
    main()
