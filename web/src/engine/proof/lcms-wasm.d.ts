// The part of lcms-wasm 1.0.5 (npm, MIT; Little CMS compiled to WebAssembly) that soft proofing uses. The package ships
// no type declarations; these follow its `lib/api.js` wrappers (handles are pointers into the WebAssembly heap, 0 on
// failure).
declare module 'lcms-wasm' {
  export interface LcmsModule {
    cmsOpenProfileFromMem(data: Uint8Array, size: number): number
    cmsCloseProfile(profile: number): void
    cmsCreate_sRGBProfile(): number
    cmsCreateLab4Profile(whitePoint: number[] | null): number
    cmsGetProfileInfoASCII(profile: number, info: number, language: string, country: string): string
    cmsGetColorSpaceASCII(profile: number): string | null
    cmsCreateTransform(input: number, inputFormat: number, output: number, outputFormat: number, intent: number, flags: number): number
    cmsCreateProofingTransform(
      input: number,
      inputFormat: number,
      output: number,
      outputFormat: number,
      proofing: number,
      intent: number,
      proofingIntent: number,
      flags: number,
    ): number
    cmsDeleteTransform(transform: number): void
    /** Float formats in and out: a Float32Array of `size` pixels (lcms-wasm allocates and frees the heap copies). */
    cmsDoTransform(transform: number, input: Float32Array, size: number): Float32Array
  }
  export function instantiate(options?: { locateFile?: (name: string, prefix: string) => string }): Promise<LcmsModule>
}
