#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 INPUT_VIDEO OUTPUT_DIR [--host USER@HOST]" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
input=$1
output_dir=$2
shift 2
# Tailscale MagicDNS is stable across local and remote networks; `.local` mDNS
# is not. `--host` and AI_PIPELINE_HOST remain explicit machine overrides.
host=${AI_PIPELINE_HOST:-debanjan@home-server.taila135aa.ts.net}
while [[ $# -gt 0 ]]; do
  case $1 in
    --host) host=${2:?missing host}; shift 2 ;;
    *) usage ;;
  esac
done

for tool in ffmpeg ffprobe python3 ssh sha256sum; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done
[[ -f $input ]] || { echo "input does not exist: $input" >&2; exit 1; }
ffprobe -v error -select_streams v:0 -show_entries stream=index -of csv=p=0 "$input" | grep -q . || {
  echo "the research pipeline currently requires an input video" >&2
  exit 1
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/audio-pwa-ai.XXXXXX")
trap 'rm -rf "$temporary"' EXIT
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote="/home/debanjan/audio-pwa-ai/runs/$run_id"
ssh_args=(-F /dev/null -o BatchMode=yes)
if [[ $host == debanjan@home-server.taila135aa.ts.net ]]; then
  # The same server key was first trusted through its stable Tailscale address.
  ssh_args+=(-o HostKeyAlias=100.94.51.105)
fi
ssh_args+=("$host")

echo "[1/8] Extracting canonical 44.1 kHz stereo Float32 model input"
ffmpeg -y -hide_banner -loglevel error -i "$input" -map 0:a:0 -vn -ac 2 -ar 44100 -c:a pcm_f32le "$temporary/source.wav"
ffprobe -v error -show_entries stream=sample_rate,channels -of compact=p=0 "$temporary/source.wav" | grep -q 'sample_rate=44100.*channels=2' || {
  echo "canonical extraction contract failed" >&2
  exit 1
}

echo "[2/8] Transferring input and pinned runners to $host"
ssh "${ssh_args[@]}" "mkdir -p '$remote/input' '$remote/models'"
ssh "${ssh_args[@]}" "cat > '$remote/input/source.wav'" < "$temporary/source.wav"
ssh "${ssh_args[@]}" "cat > '$remote/run_htdemucs_reference.py'" < "$script_dir/run_htdemucs_reference.py"
ssh "${ssh_args[@]}" "cat > '$remote/research_ai_postprocess.py'" < "$script_dir/research_ai_postprocess.py"
ssh "${ssh_args[@]}" "cat > '$remote/models/silero.onnx'" < "$script_dir/../public/models/silero-vad-v6.2.1/silero_vad_16k_op15.onnx"

echo "[3/8] Running exact-chunk HTDemucs on CUDA"
ssh "${ssh_args[@]}" "/home/debanjan/audio-pwa-ai/.venv/bin/python '$remote/run_htdemucs_reference.py' '$remote/input/source.wav' '$remote/separated'"

echo "[4/8] Running DeepFilterNet, Stage 2, Silero VAD, routing, and ducking"
ssh "${ssh_args[@]}" "/home/debanjan/audio-pwa-ai/.venv/bin/python '$remote/research_ai_postprocess.py' '$remote/separated' '$remote/models/silero.onnx' '$remote/postprocessed'"

echo "[5/8] Retrieving premaster and manifests"
ssh "${ssh_args[@]}" "cat '$remote/postprocessed/premaster.wav'" > "$temporary/premaster.wav"
ssh "${ssh_args[@]}" "cat '$remote/separated/manifest.json'" > "$output_dir/htdemucs-manifest.json"
ssh "${ssh_args[@]}" "cat '$remote/postprocessed/manifest.json'" > "$output_dir/postprocess-manifest.json"
expected_hash=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["premaster"]["sha256"])' "$output_dir/postprocess-manifest.json")
actual_hash=$(sha256sum "$temporary/premaster.wav" | cut -d' ' -f1)
[[ $actual_hash == "$expected_hash" ]] || { echo "transferred premaster hash mismatch" >&2; exit 1; }

echo "[6/8] Applying two-pass loudness and true-peak mastering"
ffmpeg -hide_banner -nostats -i "$temporary/premaster.wav" -af 'loudnorm=I=-15.6:TP=-1.2:LRA=11:print_format=json' -f null - 2> "$temporary/loudnorm-pass1.log"
python3 - "$temporary/loudnorm-pass1.log" "$temporary/loudnorm-filter.txt" <<'PY'
import json,re,sys
text=open(sys.argv[1]).read()
blocks=re.findall(r'\{[^{}]+\}', text, re.S)
if not blocks: raise SystemExit('loudnorm analysis did not return JSON')
stats=json.loads(blocks[-1])
required=['input_i','input_tp','input_lra','input_thresh','target_offset']
if any(key not in stats for key in required): raise SystemExit('loudnorm analysis is incomplete')
value=("loudnorm=I=-15.6:TP=-1.2:LRA=11:"
       f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
       f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
       f"offset={stats['target_offset']}:linear=true,aresample=48000:dither_method=triangular")
open(sys.argv[2],'w').write(value)
PY
loudnorm_filter=$(cat "$temporary/loudnorm-filter.txt")
ffmpeg -y -hide_banner -loglevel error -i "$temporary/premaster.wav" -af "$loudnorm_filter" -ar 48000 -ac 2 -c:a pcm_s24le "$output_dir/final-processed.wav"
ffmpeg -hide_banner -nostats -i "$output_dir/final-processed.wav" -af ebur128=peak=true -f null - 2> "$temporary/verification.log"
python3 - "$temporary/verification.log" <<'PY'
import re,sys
text=open(sys.argv[1]).read()
loudness=[float(x) for x in re.findall(r'^\s*I:\s*(-?[0-9.]+) LUFS',text,re.M)]
peaks=[float(x) for x in re.findall(r'^\s*Peak:\s*(-?[0-9.]+) dBFS',text,re.M)]
if not loudness or not peaks: raise SystemExit('master verification metrics missing')
if not -16.2 <= loudness[-1] <= -15.8: raise SystemExit(f'integrated loudness failed: {loudness[-1]} LUFS')
if peaks[-1] > -1.0: raise SystemExit(f'true peak failed: {peaks[-1]} dBTP')
print(f'verified {loudness[-1]:.1f} LUFS, {peaks[-1]:.1f} dBTP')
PY

echo "[7/8] Remuxing processed audio with source video"
ffmpeg -y -hide_banner -loglevel error -i "$input" -i "$output_dir/final-processed.wav" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -shortest -map_metadata 0 -movflags +faststart "$output_dir/final-processed-video.mp4"

echo "[8/8] Selecting and rendering four level-matched A/B scenes"
"$script_dir/compare-audio.sh" "$input" "$output_dir/final-processed.wav" --window 8 --count 4 --separation 60 --render "$output_dir/top-four-ai-before-after.mp4" > "$output_dir/top-four-ai-before-after.json"
sha256sum "$output_dir/final-processed.wav" "$output_dir/final-processed-video.mp4" "$output_dir/top-four-ai-before-after.mp4" > "$output_dir/SHA256SUMS"
echo "AI research-reference pipeline complete: $output_dir"
