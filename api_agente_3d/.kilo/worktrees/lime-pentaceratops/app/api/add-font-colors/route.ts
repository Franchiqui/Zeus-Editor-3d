import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const API_FONT_TEXTURE_DIR = path.join(process.cwd(), 'Api-Font-Texture');
const VENV_PYTHON = path.join(API_FONT_TEXTURE_DIR, 'venv', 'Scripts', 'python.exe');
const SCRIPT_PATH = path.join(API_FONT_TEXTURE_DIR, 'add_colors.py');
const OUTPUT_DIR = path.join(API_FONT_TEXTURE_DIR, 'fonts');
const LOCAL_PATHS_FILE = path.join(process.cwd(), 'local-paths.json');

async function getLocalPaths(): Promise<Record<string, string>> {
  try {
    const data = await fs.readFile(LOCAL_PATHS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
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

    pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    pythonProcess.on('close', (code) => {
      resolve({ success: code === 0, output: stdout, error: stderr });
    });

    pythonProcess.on('error', (err) => {
      resolve({ success: false, output: '', error: err.message });
    });
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fontFile = formData.get('font_file') as File | null;
    const colorsJson = formData.get('colors') as string | null;
    const effectFile = formData.get('effect_file') as File | null;
    const effectColor = formData.get('effect_color') as string | null;

    if (!fontFile || !colorsJson) {
      return NextResponse.json(
        { success: false, message: 'Se requieren la fuente TTF y el JSON de colores' },
        { status: 400 }
      );
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const timestamp = Date.now();
    const inputFontPath = path.join(API_FONT_TEXTURE_DIR, `input_color_${timestamp}.ttf`);
    const colorsPath = path.join(API_FONT_TEXTURE_DIR, `colors_${timestamp}.json`);
    const outputFontPath = path.join(OUTPUT_DIR, `colored_${timestamp}.ttf`);
    let effectSvgPath: string | null = null;

    // Escribir archivos temporales
    const fontBuffer = Buffer.from(await fontFile.arrayBuffer());
    await fs.writeFile(inputFontPath, fontBuffer);
    await fs.writeFile(colorsPath, colorsJson);

    if (effectFile) {
      effectSvgPath = path.join(API_FONT_TEXTURE_DIR, `effect_${timestamp}.svg`);
      const effectBuffer = Buffer.from(await effectFile.arrayBuffer());
      await fs.writeFile(effectSvgPath, effectBuffer);
    }

    const args = [
      '--font', inputFontPath,
      '--output', outputFontPath,
      '--colors', colorsPath,
    ];
    if (effectSvgPath) args.push('--effect-svg', effectSvgPath);
    if (effectColor) args.push('--effect-color', effectColor);
    if (effectFile) args.push('--effect-name', effectFile.name);

    const result = await runPythonScript(args);

    console.log('[API add-colors] Python result:', { success: result.success, output: result.output?.substring(0, 500), error: result.error?.substring(0, 500) });

    // Limpiar temporales
    try {
      await fs.unlink(inputFontPath);
      await fs.unlink(colorsPath);
      if (effectSvgPath) await fs.unlink(effectSvgPath);
    } catch {}

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: 'Error procesando la fuente', detail: result.error || result.output },
        { status: 500 }
      );
    }

    const outputBuffer = await fs.readFile(outputFontPath);
    const filename = path.basename(outputFontPath);

    // Copiar a carpeta de fuentes local si está configurada
    const localPaths = await getLocalPaths();
    if (localPaths.fuentes) {
      try {
        await fs.mkdir(localPaths.fuentes, { recursive: true });
        await fs.copyFile(outputFontPath, path.join(localPaths.fuentes, filename));
      } catch (e) {
        console.error('[API add-colors] Error copying to local fuentes:', e);
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
    console.error('Error en /api/add-font-colors:', error);
    return NextResponse.json(
      { success: false, message: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST with form-data: font_file, colors (JSON), effect_file (optional), effect_color (optional)',
  });
}