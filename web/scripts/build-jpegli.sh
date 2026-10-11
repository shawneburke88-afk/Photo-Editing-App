#!/usr/bin/env bash
# Builds web/src/vendor/jpegli/ (jpegli.js + jpegli.wasm): Google's jpegli JPEG encoder compiled to
# WebAssembly with LightBench's small wrapper (web/native/jpegli/lightbench_jpegli.cc).
#
# Needs git, cmake, ninja and Emscripten on PATH (tested with emsdk 4.0.10).
# Usage: web/scripts/build-jpegli.sh [work-dir]
# The output is committed, so building is only needed when updating jpegli or the wrapper.
set -euo pipefail

JPEGLI_REPO=https://github.com/google/jpegli.git
JPEGLI_COMMIT=031a0077f5799a6041004267fc12b956c1f52a20

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
OUT="$HERE/src/vendor/jpegli"
SRC="$WORK/jpegli"
BUILD="$SRC/build-wasm"

if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none "$JPEGLI_REPO" "$SRC"
fi
git -C "$SRC" checkout --quiet "$JPEGLI_COMMIT"
git -C "$SRC" submodule update --init --depth 1 third_party/highway third_party/libjpeg-turbo third_party/lcms third_party/skcms

emcmake cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
  -DJPEGLI_ENABLE_TOOLS=OFF -DJPEGLI_ENABLE_DEVTOOLS=OFF -DJPEGLI_ENABLE_BENCHMARK=OFF \
  -DJPEGLI_ENABLE_OPENEXR=OFF -DJPEGLI_ENABLE_SJPEG=OFF -DJPEGLI_BUNDLE_LIBPNG=OFF \
  -DCMAKE_C_FLAGS=-msimd128 -DCMAKE_CXX_FLAGS=-msimd128
cmake --build "$BUILD" --target jpegli-static hwy

mkdir -p "$OUT"
emcc -O3 -msimd128 -std=c++17 \
  -I "$SRC" -I "$BUILD/lib/include/jpegli" \
  "$HERE/native/jpegli/lightbench_jpegli.cc" \
  "$BUILD/lib/libjpegli-static.a" "$BUILD/third_party/highway/libhwy.a" \
  -o "$OUT/jpegli.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_lb_jpegli_encode,_lb_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32

cp "$SRC/LICENSE" "$OUT/LICENSE"
cp "$SRC/PATENTS" "$OUT/PATENTS"
echo "jpegli $JPEGLI_COMMIT built into $OUT"
ls -l "$OUT"
