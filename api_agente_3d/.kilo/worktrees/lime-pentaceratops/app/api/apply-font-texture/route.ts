import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const API_FONT_TEXTURE_DIR = path.join(process.cwd(), 'Api-Font-Texture');
const VENV_PYTHON = path.join(API_FONT_TEXTURE_DIR, 'venv', 'Scripts', 'python.exe');
const SCRIPT_PATH = path.join(API_FONT_TEXTURE_DIR, 'aplicar_textura_completa.py');
const OUTPUT_DIR = path.join(API_FONT_TEXTURE_DIR, 'fonts');
const LOCAL_PATHS_FILE = path.join(process.cwd(), 'local-paths.json');

// Get local paths (including fuentes folder) from file
async function getLocalPaths(): Promise<Record<string, string>> {
  try {
    const data = await fs.readFile(LOCAL_PATHS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    // Fallback: check localStorage via electron bridge if available
    // For now, return empty if file doesn't exist
    return {};
  }
}

async function runPythonScript(args: string[]): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const pythonProcess = spawn(VENV_PYTHON, [SCRIPT_PATH, ...args], {
      cwd: API_FONT_TEXTURE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: API_FONT_TEXTURE_DIR,
      },
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr,
      });
    });

    pythonProcess.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fontFile = formData.get('font_file') as File | null;
    const svgFile = formData.get('svg_file') as File | null;
    const effectFile = formData.get('svg_effect_file') as File | null;
    const effectColor = formData.get('effect_color') as string | null;
    const paletteJson = formData.get('palettes') as string | null;
    const texturedGlyphsJson = formData.get('textured_glyphs') as string | null;
    const vectorTexturesJson = formData.get('vector_textures') as string | null;
    const scale = formData.get('scale') as string | null;
    const baseColorIndex = formData.get('base_color_index') as string | null;
    const textureColorIndex = formData.get('texture_color_index') as string | null;
    const specificLetter = formData.get('specific_letter') as string | null;

    if (!fontFile || (!svgFile && !effectFile)) {
      return NextResponse.json(
        { success: false, message: 'Se requieren la fuente TTF y al menos una textura SVG o un efecto de iluminación' },
        { status: 400 }
      );
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const timestamp = Date.now();
    const fontExt = fontFile.name.split('.').pop() || 'ttf';
    const inputFontPath = path.join(API_FONT_TEXTURE_DIR, `input_${timestamp}.${fontExt}`);
    const inputSvgPath = svgFile ? path.join(API_FONT_TEXTURE_DIR, `texture_${timestamp}.svg`) : null;
    const inputEffectSvgPath = effectFile ? path.join(API_FONT_TEXTURE_DIR, `effect_${timestamp}.svg`) : null;
    const outputFontPath = path.join(OUTPUT_DIR, `textured_${timestamp}.ttf`);
    let palettePath: string | null = null;

    const fontBuffer = Buffer.from(await fontFile.arrayBuffer());
    await fs.writeFile(inputFontPath, fontBuffer);

    if (inputSvgPath && svgFile) {
      const svgBuffer = Buffer.from(await svgFile.arrayBuffer());
      await fs.writeFile(inputSvgPath, svgBuffer);
    }
    if (inputEffectSvgPath && effectFile) {
      const effectBuffer = Buffer.from(await effectFile.arrayBuffer());
      await fs.writeFile(inputEffectSvgPath, effectBuffer);
    }

    // Write palette to temp file if provided
    if (paletteJson) {
      palettePath = path.join(API_FONT_TEXTURE_DIR, `palette_${timestamp}.json`);
      try {
        // UI sends: [{colors: [[r,g,b,a],...], palette_type: 0, name: "..."}] (array)
        // Python expects: [[r,g,b,a],...] (just the colors array)
        const parsed = JSON.parse(paletteJson);
        console.log('[API] Parsed palette:', JSON.stringify(parsed).substring(0, 500));
        const colors = parsed[0]?.colors || parsed.colors || parsed;
        console.log('[API] Extracted colors:', JSON.stringify(colors).substring(0, 500));
        await fs.writeFile(palettePath, JSON.stringify(colors));
      } catch (e) {
        console.error('[API] Palette parse error:', e);
        await fs.writeFile(palettePath, paletteJson);
      }
    }

    const args = [
      '--font', inputFontPath,
      '--output', outputFontPath,
    ];
    if (inputSvgPath) args.push('--svg', inputSvgPath);
    if (inputEffectSvgPath) args.push('--effect-svg', inputEffectSvgPath);
    if (effectColor) args.push('--effect-color', effectColor);
    // Pasar el nombre del efecto para que el backend elija modo (glow/outline/...)
    if (effectFile) args.push('--effect-name', effectFile.name);

    if (scale) args.push('--scale', scale);
    if (baseColorIndex) args.push('--base-color', baseColorIndex);
    if (textureColorIndex) args.push('--texture-color', textureColorIndex);
    if (specificLetter) args.push('--letter', specificLetter);
    if (palettePath) args.push('--palette', palettePath);

    const result = await runPythonScript(args);

    console.log('[API] Python result:', { success: result.success, output: result.output?.substring(0, 500), error: result.error?.substring(0, 500) });

    try {
      await fs.unlink(inputFontPath);
      if (inputSvgPath) await fs.unlink(inputSvgPath);
      if (inputEffectSvgPath) await fs.unlink(inputEffectSvgPath);
      if (palettePath) await fs.unlink(palettePath);
    } catch {}

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: 'Error procesando la fuente', detail: result.error || result.output },
        { status: 500 }
      );
    }

    const outputBuffer = await fs.readFile(outputFontPath);
    const filename = path.basename(outputFontPath);

    // Also copy to local fuentes folder if configured
    const localPaths = await getLocalPaths();
    if (localPaths.fuentes) {
      try {
        await fs.mkdir(localPaths.fuentes, { recursive: true });
        const localFontPath = path.join(localPaths.fuentes, filename);
        await fs.copyFile(outputFontPath, localFontPath);
        console.log('[API] Font copied to local fuentes folder:', localFontPath);
      } catch (e) {
        console.error('[API] Error copying font to local fuentes folder:', e);
      }
    }

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'font/ttf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Output-Filename': filename,
      },
    });
  } catch (error) {
    console.error('Error en /api/apply-font-texture:', error);
    return NextResponse.json(
      { success: false, message: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST with form-data: font_file, svg_file, palettes, textured_glyphs, vector_textures, scale, base_color_index, texture_color_index',
  });
}