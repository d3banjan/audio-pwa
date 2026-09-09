#!/usr/bin/env python3
"""Render an honest per-bus walkthrough for selected I-014 scenes."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np


RATE = 48_000
STEMS = ("dialogue", "music", "ambience", "sfx")


def decode(path: Path, start: float = 0, duration: float = 8) -> np.ndarray:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(duration), "-i", str(path),
         "-vn", "-ac", "2", "-ar", str(RATE), "-f", "f32le", "pipe:1"],
        stdout=subprocess.PIPE,
        check=True,
    )
    return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2).astype(np.float64)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("processed", type=Path)
    parser.add_argument("stems", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    report = json.loads(args.report.read_text())
    segments = report["segments"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="stem-walkthrough-", dir=args.output.parent) as temporary:
        temp = Path(temporary)
        clips: list[Path] = []
        gain_evidence = []
        for index, segment in enumerate(segments):
            duration = float(segment["end"] - segment["start"])
            buses = {stem: decode(args.stems / f"{index:02d}-{stem}.wav", 0, duration) for stem in STEMS}
            premaster = decode(args.stems / f"{index:02d}-premaster.wav", 0, duration)
            reconstructed = sum(buses.values())
            safety_gain = float(np.sum(reconstructed * premaster) / max(np.sum(reconstructed * reconstructed), 1e-20))
            error = float(np.max(np.abs(reconstructed * safety_gain - premaster)))
            if error > 3e-6:
                raise RuntimeError(f"Scene {index} bus reconstruction failed: {error}")
            final = decode(args.processed, float(segment["start"]), duration)
            master_gain = float(np.sum(premaster * final) / max(np.sum(premaster * premaster), 1e-20))
            match_gain = 10 ** (float(segment["processed_gain_db_for_level_match"]) / 20)
            stem_gain = safety_gain * master_gain * match_gain
            gain_evidence.append({
                "scene": index + 1,
                "bus_reconstruction_max_error": error,
                "common_premaster_safety_gain_db": 20 * np.log10(abs(safety_gain)),
                "master_gain_db": 20 * np.log10(abs(master_gain)),
                "common_stem_audition_gain_db": 20 * np.log10(abs(stem_gain)),
            })

            stages = [
                ("ORIGINAL MIX", args.source, float(segment["start"]), 1.0, "black@0.72"),
                ("DIALOGUE", args.stems / f"{index:02d}-dialogue.wav", 0.0, stem_gain, "0x547e9b@0.90"),
                ("MUSIC", args.stems / f"{index:02d}-music.wav", 0.0, stem_gain, "0x8b6f9e@0.90"),
                ("AMBIENCE", args.stems / f"{index:02d}-ambience.wav", 0.0, stem_gain, "0x628d7a@0.90"),
                ("SFX", args.stems / f"{index:02d}-sfx.wav", 0.0, stem_gain, "0xa87962@0.90"),
                ("PROCESSED MIX", args.processed, float(segment["start"]), match_gain, "0x507f68@0.90"),
            ]
            for stage_index, (label, audio, audio_start, gain, color) in enumerate(stages):
                clip = temp / f"{index:02d}-{stage_index:02d}.mp4"
                width = max(170, 45 + len(label) * 22)
                subprocess.run([
                    "ffmpeg", "-v", "error", "-i", str(args.source), "-i", str(audio),
                    "-filter_complex",
                    f"[0:v]trim=start={segment['start']}:end={segment['end']},setpts=PTS-STARTPTS,"
                    f"drawbox=x=28:y=28:w={width}:h=60:color={color}:t=fill,"
                    f"drawtext=text='{label}':x=48:y=43:fontsize=28:fontcolor=white[v];"
                    f"[1:a]atrim=start={audio_start}:end={audio_start + duration},volume={gain},"
                    f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st={duration - 0.02}:d=0.02[a]",
                    "-map", "[v]", "-map", "[a]", "-ac", "2", "-ar", str(RATE),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "160k", "-shortest", str(clip),
                ], check=True)
                clips.append(clip)

        concat = temp / "concat.txt"
        concat.write_text("".join(f"file '{clip}'\n" for clip in clips))
        rendered = temp / "rendered.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
            "-af", "aresample=async=1:first_pts=0", "-movflags", "+faststart", str(rendered),
        ], check=True)
        probe = json.loads(subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(rendered),
        ], stdout=subprocess.PIPE, check=True).stdout)
        stream_types = {stream["codec_type"] for stream in probe.get("streams", [])}
        duration = float(probe.get("format", {}).get("duration", 0))
        expected = sum(float(item["end"] - item["start"]) for item in segments) * 6
        if stream_types != {"audio", "video"} or abs(duration - expected) > 0.5:
            raise RuntimeError(f"Walkthrough verification failed: {stream_types}, {duration=}, {expected=}")
        rendered.replace(args.output)
        args.output.with_suffix(".json").write_text(json.dumps({"segments": segments, "gain_evidence": gain_evidence}, indent=2) + "\n")


if __name__ == "__main__":
    main()
