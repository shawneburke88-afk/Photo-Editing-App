#!/usr/bin/env bash
# AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): the stages the "AI models" workflow's denoise-spike task runs
# on GitHub's runner (which can reach Google Drive, the UCLouvain Dataverse and raw.pixls.us). Read-only: nothing is
# committed or published. $P is the Python of the job's virtual environment, $RUNNER_TEMP/res becomes the artifact.
#
#   probe[:REGEX]   what the sources offer (fetch.py probe), listing the dataset files that match REGEX
#   STAGE[,STAGE…]  of: export (checkpoint -> ONNX, checks, fp16, tensors), pairs (white balance and routes A/B against
#                   RawNIND clean frames), tiling, cameras (raw.pixls.us raws, synthetic high ISO), speed
set -euo pipefail
STAGE="${1:-probe}"
D=web/scripts/denoise
T="${RUNNER_TEMP}"
RES="$T/res"
mkdir -p "$RES"
S="$RES/summary.txt"
export DN_B64="${DN_B64:-16}"
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$S"; }
PY() { "$P" -I "$@" 2> >(grep -v -i "warning\|warn(" >&2); }

if [[ "$STAGE" == probe* ]]; then
  rx=""; [[ "$STAGE" == probe:* ]] && rx="${STAGE#probe:}"
  PY $D/fetch.py probe --grep "$rx" --max-files 400 --out "$RES/dataverse-files.json" 2>&1 | tee -a "$S"
  exit 0
fi

CK="DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-bayer_ms-ssim_mgout_notrans_valeither_-4"
CK2="DenoiserTrainingBayerToProfiledRGB_4ch_2024-11-22-bayer_ms-ssim_mgout_notrans_valeither_noowwnpics_mgdef_-1"
W="$T/w"; O="$T/onnx"; R="$T/raws"; mkdir -p "$O" "$R"

prepare() {
  say "## Inputs"
  PY $D/fetch.py weights --out "$W" --match "($CK|$CK2)/(saved_models/iter_[0-9]+\.pt$|args\.yaml$|train_cmd\.sh$|test_cmd\.sh$)" 2>&1 | tee -a "$S"
  PY $D/fetch.py dtmodel --out "$T/dt" 2>&1 | tee -a "$S"
  CKPT=$(ls "$W"/rawnind_denoise/$CK/saved_models/iter_*.pt | head -1)
  CKPT2=$(ls "$W"/rawnind_denoise/$CK2/saved_models/iter_*.pt | head -1)
  say "main checkpoint: $CKPT"; say "variant trained without the authors' own pictures (by its name): $CKPT2"
  for f in "$W"/rawnind_denoise/*/args.yaml "$W"/rawnind_denoise/*/train_cmd.sh; do say "--- $f"; head -c 6000 "$f" | tee -a "$S"; say ""; done
  # a first pair, for real test tiles
  PY $D/fetch.py dataverse --out "$R" "m100_board_iso6400=Bayer_UNK_TEST_LucieB_board_ISO6400_" "m100_board_gt=Bayer_UNK_TEST_LucieB_board_GT_ISO100_" 2>&1 | tee -a "$S"
  PY -c "
import sys; sys.path.insert(0, '$D')
import dn_lib as L, numpy as np, glob
raw = L.load_raw(glob.glob('$R/m100_board_iso6400.*')[0]); n = L.normalise(raw)
y0, x0 = L.rggb_origin(raw['cfa']); H, W = n.shape
ts = [L.pack(n[y0 + y:y0 + y + 1024, x0 + x:x0 + x + 1024]) for y, x in ((0, 0), ((H // 4) * 2, (W // 4) * 2), (H - 1026, W - 1026), ((H // 8) * 2, (W // 2) * 2 - 1024))]
np.save('$T/tiles.npy', np.stack(ts)); print('test tiles', np.stack(ts).shape, [float(t.mean()) for t in ts], [float(t.max()) for t in ts])
" 2>&1 | tee -a "$S"
  say "## Export (PyTorch $("$P" -c 'import torch; print(torch.__version__)'), ONNX Runtime $("$P" -c 'import onnxruntime; print(onnxruntime.__version__)'))"
  PY $D/export.py export --weights "$CKPT" --out "$O" --name rawnind_bayer --sizes 512,256 --dynamic --tiles "$T/tiles.npy" 2>&1 | tee -a "$S"
  PY $D/export.py export --weights "$CKPT2" --out "$O" --name rawnind_bayer_noown --sizes 512 --tiles "$T/tiles.npy" 2>&1 | tee -a "$S"
  M="$O/rawnind_bayer_512.onnx"; MD="$O/rawnind_bayer_dyn.onnx"; M2="$O/rawnind_bayer_noown_512.onnx"; DT="$T/dt/rawdenoise-nind/model_bayer.onnx"
}

fetch_pairs() {
  PY $D/fetch.py dataverse --out "$R" \
    "7d_gt=Bayer_TEST_7D-2_GT_ISO100_" "7d_iso3200=Bayer_TEST_7D-2_ISO3200_" "7d_iso12800=Bayer_TEST_7D-2_ISO12800_" \
    "6d_gt=Bayer_TEST_Vaxt-i-trad_GT_ISO100_" "6d_iso6400=Bayer_TEST_Vaxt-i-trad_ISO6400_" "6d_iso51200=Bayer_TEST_Vaxt-i-trad_ISO51200_" \
    "c500d_gt=Bayer_TEST_MuseeL-Saint-Pierre-C500D_GT_ISO100_" "c500d_iso3200=Bayer_TEST_MuseeL-Saint-Pierre-C500D_ISO3200_" \
    "a7c_titus_gt=Bayer_TEST_TitusToys_GT_ISO50_" "a7c_titus_iso6400=Bayer_TEST_TitusToys_ISO6400_" "a7c_titus_iso51200=Bayer_TEST_TitusToys_ISO51200_" \
    "a7c_board_gt=Bayer_TEST_boardgames_top_GT_ISO50_" "a7c_board_iso64000=Bayer_TEST_boardgames_top_ISO64000_" \
    "gh1_gt=Bayer_TEST_Pen-pile_GT_ISO100_" "gh1_iso3200=Bayer_TEST_Pen-pile_ISO3200_" \
    "d60_gt=Bayer_TEST_D60-1_GT_ISO100_" "d60_iso800=Bayer_TEST_D60-1_ISO800_" \
    "m100_board_iso25600=Bayer_UNK_TEST_LucieB_board_ISO25600_" \
    "m100_groceries_gt=Bayer_UNK_TEST_LucieB_groceries_GT_ISO100_" "m100_groceries_iso3200=Bayer_UNK_TEST_LucieB_groceries_ISO3200_" "m100_groceries_iso25600=Bayer_UNK_TEST_LucieB_groceries_ISO25600_" \
    "m100_plants_gt=Bayer_UNK_TEST_LucieB_painted_plants_GT_ISO100_" "m100_plants_iso6400=Bayer_UNK_TEST_LucieB_painted_plants_ISO6400_" \
    2>&1 | tee -a "$S"
}
f() { ls "$R"/$1.* | head -1; }

prepare
IFS=',' read -ra STAGES <<< "$STAGE"
for st in "${STAGES[@]}"; do
  case "$st" in
    export)
      say "## Against darktable-ai's model_bayer.onnx"
      PY $D/export.py compare --model "$M" --other "$DT" --tiles "$T/tiles.npy" 2>&1 | tee -a "$S"
      say "## The variant without the authors' own pictures against the main checkpoint (different weights expected)"
      PY $D/export.py compare --model "$M2" --other "$M" --tiles "$T/tiles.npy" 2>&1 | tee -a "$S"
      say "## fp16"
      # (the all-fp16 PyTorch run and the rescale check need a CPU with AVX512-FP16: run locally, see the write-up)
      PY $D/export.py fp16 --weights "$CKPT" --model "$M" --out "$O" --tiles "$T/tiles.npy" --scale-inputs 2>&1 | tee -a "$S"
      say "## Largest tensors"
      PY $D/export.py tensors "$M" --sizes 1024,768,640,512,384,256 2>&1 | tee -a "$S"
      ;;
    pairs)
      say "## RawNIND pairs: white balance in front of the model, routes A and B"
      fetch_pairs
      PY $D/quality.py pairs --model "$M" --out "$RES/pairs" --wb none,d65,shot --ref-b \
        "7D_ISO3200=$(f 7d_iso3200),$(f 7d_gt)" "7D_ISO12800=$(f 7d_iso12800),$(f 7d_gt)" \
        "6D_ISO6400=$(f 6d_iso6400),$(f 6d_gt)" "6D_ISO51200=$(f 6d_iso51200),$(f 6d_gt)" \
        "C500D_ISO3200=$(f c500d_iso3200),$(f c500d_gt)" \
        "A7C_Titus_ISO6400=$(f a7c_titus_iso6400),$(f a7c_titus_gt)" "A7C_Titus_ISO51200=$(f a7c_titus_iso51200),$(f a7c_titus_gt)" \
        "A7C_board_ISO64000=$(f a7c_board_iso64000),$(f a7c_board_gt)" \
        "GH1_ISO3200=$(f gh1_iso3200),$(f gh1_gt)" "D60_ISO800=$(f d60_iso800),$(f d60_gt)" \
        "M100_board_ISO6400=$(f m100_board_iso6400),$(f m100_board_gt)" "M100_board_ISO25600=$(f m100_board_iso25600),$(f m100_board_gt)" \
        "M100_groceries_ISO3200=$(f m100_groceries_iso3200),$(f m100_groceries_gt)" "M100_groceries_ISO25600=$(f m100_groceries_iso25600),$(f m100_groceries_gt)" \
        "M100_plants_ISO6400=$(f m100_plants_iso6400),$(f m100_plants_gt)" 2>&1 | tee -a "$S"
      ;;
    noown)
      say "## The variant trained without the authors' own pictures, same pairs (white balance none)"
      fetch_pairs
      PY $D/quality.py pairs --model "$M2" --out "$RES/pairs-noown" --wb none --crops 2 \
        "7D_ISO12800=$(f 7d_iso12800),$(f 7d_gt)" "6D_ISO6400=$(f 6d_iso6400),$(f 6d_gt)" "A7C_Titus_ISO51200=$(f a7c_titus_iso51200),$(f a7c_titus_gt)" \
        "M100_board_ISO25600=$(f m100_board_iso25600),$(f m100_board_gt)" "M100_groceries_ISO3200=$(f m100_groceries_iso3200),$(f m100_groceries_gt)" 2>&1 | tee -a "$S"
      PY $D/quality.py pairs --model "$M" --out "$RES/pairs-main-2crops" --wb none --crops 2 \
        "7D_ISO12800=$(f 7d_iso12800),$(f 7d_gt)" "6D_ISO6400=$(f 6d_iso6400),$(f 6d_gt)" "A7C_Titus_ISO51200=$(f a7c_titus_iso51200),$(f a7c_titus_gt)" \
        "M100_board_ISO25600=$(f m100_board_iso25600),$(f m100_board_gt)" "M100_groceries_ISO3200=$(f m100_groceries_iso3200),$(f m100_groceries_gt)" 2>&1 | tee -a "$S"
      ;;
    tiling)
      say "## Tiling on 24 MP raws"
      PY $D/fetch.py dataverse --out "$R" "m100_board_iso25600=Bayer_UNK_TEST_LucieB_board_ISO25600_" "a7c_titus_iso6400=Bayer_TEST_TitusToys_ISO6400_" "a7c_board_iso64000=Bayer_TEST_boardgames_top_ISO64000_" 2>&1 | tee -a "$S"
      PY $D/quality.py tiling --model "$M" --dyn-model "$MD" --raw "$(f m100_board_iso6400)" --out "$RES/tiling-m100" --panels 2>&1 | tee -a "$S"
      PY $D/quality.py tiling --model "$M" --dyn-model "$MD" --raw "$(f a7c_titus_iso6400)" --out "$RES/tiling-a7c" --panels --tiles 512:32 2>&1 | tee -a "$S"
      PY $D/quality.py tiling --model "$M" --raw "$(f a7c_board_iso64000)" --out "$RES/tiling-a7c-64000" --panels --tiles 512:32 2>&1 | tee -a "$S"
      PY $D/quality.py tiling --model "$M" --dyn-model "$MD" --raw "$(f m100_board_iso6400)" --out "$RES/tiling-m100-d65" --wb d65 --tiles 512:32 2>&1 | tee -a "$S"
      ;;
    cameras)
      say "## Other cameras (raw.pixls.us)"
      PY $D/fetch.py pixls --out "$R/px" ${PIXLS_FILES:-"Nikon/D5200/NIKON_D5200_14_bit_compressed.NEF" "Nikon/D5200/_DSC7535.NEF"} 2>&1 | tee -a "$S"
      PY $D/fetch.py pixls-find --out "$R/px" "Nikon/D5100/" "Nikon/D5300/" "Nikon/D7100/" "Nikon/D7200/" "Nikon/D750/" "Nikon/D3300/" "Nikon/Z 6/" "Canon/EOS 80D/" "Canon/EOS 6D/" "Canon/EOS R6/" \
        "Canon/EOS M50/" "Sony/ILCE-6000/" "Sony/ILCE-7M3/" "Sony/ILCE-7C/" "Panasonic/DC-G9/" "Olympus/E-M10MarkII/" "Olympus/E-M5/" "Pentax/K-5/" "Pentax/K-3/" "Fujifilm/X100/" "Fujifilm/X-A1/" 2>&1 | tee -a "$S" || true
      args=(); for p in "$R"/px/*; do n=$(basename "$p"); args+=("${n%.*}=$p"); done
      PY $D/quality.py single --model "$M" --out "$RES/cameras" --synth-stops "${SYNTH:-4,6}" --hot 2000 --strength --cache "${args[@]}" 2>&1 | tee -a "$S"
      ;;
    *)
      say "unknown stage $st"; exit 1 ;;
  esac
done
grep -v "^B64JPEG " "$S" > "$S.tmp" && mv "$S.tmp" "$S"
ls -la "$RES" "$RES"/* | head -80
