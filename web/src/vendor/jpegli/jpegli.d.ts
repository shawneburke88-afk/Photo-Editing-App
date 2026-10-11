// Types for the Emscripten module built by scripts/build-jpegli.sh.
export interface JpegliModule {
  HEAPU8: Uint8Array
  HEAPU32: Uint32Array
  _malloc(size: number): number
  _free(ptr: number): void
  _lb_free(ptr: number): void
  _lb_jpegli_encode(rgb: number, width: number, height: number, quality: number, subsampling: number, progressive: number, outSize: number): number
}
declare const createModule: (options?: { locateFile?: (path: string) => string }) => Promise<JpegliModule>
export default createModule
