# Generated browser fixtures

`generated-tone-aac.mp4` is a repository-owned synthetic test fixture. It contains one second of a mathematically generated 440 Hz sine wave at 48 kHz and a solid-color 160×90 H.264 Baseline picture. It contains no third-party recording or personal data and is distributed under the repository's MIT license.

It can be reproduced with:

```sh
ffmpeg -f lavfi -i color=c=lavender:s=160x90:r=24:d=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart -shortest generated-tone-aac.mp4
```
