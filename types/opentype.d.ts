declare module 'opentype.js' {
  export interface GlyphOptions {
    name?: string | null;
    unicode?: number;
    unicodes?: number[];
    advanceWidth?: number;
    path?: Path;
  }

  export class Path {
    commands: unknown[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
  }

  export class Glyph {
    index: number;
    name: string | null;
    unicode?: number;
    unicodes: number[];
    advanceWidth: number;
    path: Path;
    constructor(options: GlyphOptions);
  }

  export interface FontConstructorOptions {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
  }

  export class Font {
    names: { fontFamily: { en: string }; fontSubfamily: { en: string } };
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
    constructor(options: FontConstructorOptions);
    toArrayBuffer(): ArrayBuffer;
    download(fileName?: string): void;
  }

  export function parse(buffer: ArrayBuffer): Font;
  export function load(url: string): Promise<Font>;
  export function loadSync(url: string): Font;
}
