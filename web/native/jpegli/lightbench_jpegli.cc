// LightBench's WebAssembly entry point for Google's jpegli JPEG encoder (https://github.com/google/jpegli,
// BSD-3-Clause + patent grant). Encodes 8-bit RGB with the settings chosen in
// docs/research/JPEG_ENCODER_BENCHMARK.md. The settings mirror jpegli's own encoder
// (lib/extras/enc/jpegli.cc): adaptive quantisation on, progressive level 2, quality → distance via
// jpegli_quality_to_distance.
//
// Built by web/scripts/build-jpegli.sh. Copyright (c) LightBench contributors, GPL-3.0-or-later.

#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>

#include "lib/jpegli/encode.h"

#include <emscripten/emscripten.h>

namespace {

void ErrorExit(j_common_ptr cinfo) {
  jmp_buf* env = static_cast<jmp_buf*>(cinfo->client_data);
  longjmp(*env, 1);
}

}  // namespace

extern "C" {

/**
 * Encodes `rgb` (width × height × 3 bytes, top row first) to JPEG.
 * quality: 1–100 (jpegli scale); subsampling: 444, 422 or 420; progressive: 0–2 (jpegli level).
 * Returns a malloc'd buffer (free with lb_free) and writes its size to *out_size; returns 0 on failure.
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* lb_jpegli_encode(const uint8_t* rgb, int width, int height, int quality, int subsampling,
                          int progressive, uint32_t* out_size) {
  jpeg_compress_struct cinfo;
  jpeg_error_mgr jerr;
  jmp_buf env;
  unsigned char* buffer = nullptr;
  unsigned long size = 0;  // NOLINT(runtime/int): libjpeg API
  cinfo.err = jpegli_std_error(&jerr);
  jerr.error_exit = &ErrorExit;
  if (setjmp(env)) {
    jpegli_destroy_compress(&cinfo);
    free(buffer);
    *out_size = 0;
    return nullptr;
  }
  cinfo.client_data = &env;
  jpegli_create_compress(&cinfo);
  jpegli_mem_dest(&cinfo, &buffer, &size);
  cinfo.image_width = width;
  cinfo.image_height = height;
  cinfo.input_components = 3;
  cinfo.in_color_space = JCS_RGB;
  jpegli_set_defaults(&cinfo);
  const int h = subsampling == 444 ? 1 : 2;
  const int v = subsampling == 420 ? 2 : 1;
  cinfo.comp_info[0].h_samp_factor = h;
  cinfo.comp_info[0].v_samp_factor = v;
  for (int i = 1; i < cinfo.num_components; ++i) {
    cinfo.comp_info[i].h_samp_factor = 1;
    cinfo.comp_info[i].v_samp_factor = 1;
  }
  jpegli_enable_adaptive_quantization(&cinfo, TRUE);
  jpegli_set_distance(&cinfo, jpegli_quality_to_distance(quality), TRUE);
  jpegli_set_progressive_level(&cinfo, progressive);
  jpegli_start_compress(&cinfo, TRUE);
  while (cinfo.next_scanline < cinfo.image_height) {
    JSAMPROW row = const_cast<uint8_t*>(rgb) + static_cast<size_t>(cinfo.next_scanline) * width * 3;
    jpegli_write_scanlines(&cinfo, &row, 1);
  }
  jpegli_finish_compress(&cinfo);
  jpegli_destroy_compress(&cinfo);
  *out_size = static_cast<uint32_t>(size);
  return buffer;
}

EMSCRIPTEN_KEEPALIVE
void lb_free(void* p) { free(p); }

}  // extern "C"
