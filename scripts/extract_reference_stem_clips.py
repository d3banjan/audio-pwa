#!/usr/bin/env python3
"""Extract exact short stem ranges from one completed I-014 server run."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--starts", required=True, help="comma-separated seconds")
    parser.add_argument("--duration", type=float, default=8.0)
    args = parser.parse_args()

    starts = [float(value) for value in args.starts.split(",")]
    if not starts or any(value < 0 for value in starts) or args.duration <= 0:
        raise ValueError("starts and duration must describe positive timeline ranges")
    args.output.mkdir(parents=True, exist_ok=True)

    # These are the processed mix buses written before final mastering. Keeping
    # their common gain preserves the audible contribution of each channel.
    for stem in ("dialogue", "music", "ambience", "sfx", "premaster"):
        path = args.run / "postprocessed" / f"{stem}.wav"
        with sf.SoundFile(path) as audio:
            if audio.samplerate != 48_000 or audio.channels != 2:
                raise RuntimeError(f"Unexpected stem contract: {path}")
            frames = round(args.duration * audio.samplerate)
            for index, start in enumerate(starts):
                audio.seek(round(start * audio.samplerate))
                clip = audio.read(frames, dtype="float32", always_2d=True)
                if clip.shape != (frames, 2) or not np.isfinite(clip).all():
                    raise RuntimeError(f"Incomplete stem clip: {stem} at {start}s")
                sf.write(args.output / f"{index:02d}-{stem}.wav", clip, 48_000, subtype="FLOAT")


if __name__ == "__main__":
    main()
