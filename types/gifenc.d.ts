declare module 'gifenc' {
  export interface GIFEncoderOptions {
    loop?: number;
    auto?: boolean;
    initialCapacity?: number;
    quality?: number;
  }

  export interface GIFEncoderFrameOptions {
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    palette?: number[][] | null;
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    get buffer(): Uint8Array;
    get stream(): { readonly buffer: Uint8Array; readonly bytes(): Uint8Array };
    writeHeader(): void;
    writeFrame(index: Uint8Array | number[], width: number, height: number, opts?: GIFEncoderFrameOptions): void;
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance;
}
