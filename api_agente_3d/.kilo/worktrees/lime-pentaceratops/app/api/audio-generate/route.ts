import { NextResponse } from 'next/server';

const COMFYUI_HOST = process.env.COMFYUI_HOST || '127.0.0.1';
const COMFYUI_PORT = parseInt(process.env.COMFYUI_PORT || '8188', 10);
const COMFYUI_URL = `http://${COMFYUI_HOST}:${COMFYUI_PORT}`;

function loadWorkflow(): any {
  const fs = require('fs');
  const path = require('path');
  const workflowPath = path.join(process.cwd(), 'docs', 'audio_stable_audio_example.json');
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  return JSON.parse(raw);
}

function convertWorkflowToApiFormat(wf: any): any {
  const apiPrompt: any = {};
  const nodeMap = new Map<number, any>();
  const linkSourceMap = new Map<number, { nodeId: number; outputIndex: number }>();

  for (const link of wf.links || []) {
    const [linkId, fromNodeId, fromOutputIndex] = link;
    linkSourceMap.set(linkId, { nodeId: fromNodeId, outputIndex: fromOutputIndex });
  }

  for (const node of wf.nodes || []) {
    nodeMap.set(node.id, node);
  }

  for (const node of wf.nodes || []) {
    if (node.type === 'MarkdownNote') continue;
    const entry: any = {
      class_type: node.type,
      inputs: {},
    };

    for (const input of node.inputs || []) {
      const linkId = input.link;
      if (linkId !== undefined && linkId !== null && linkId !== 0) {
        const source = linkSourceMap.get(linkId);
        if (source) {
          const srcNode = nodeMap.get(source.nodeId);
          if (srcNode) {
            entry.inputs[input.name] = [String(source.nodeId), source.outputIndex];
            continue;
          }
        }
      }

      const widgetIndex = (input as any).widgetIndex;
      if (widgetIndex !== undefined && widgetIndex !== null) {
        const wv = node.widgets_values || [];
        const value = wv[widgetIndex];
        if (value !== undefined) {
          entry.inputs[input.name] = value;
        }
      }
    }

    const wv = node.widgets_values || [];
    if (node.type === 'CLIPTextEncode') {
      entry.inputs.text = wv[0] ?? '';
    } else if (node.type === 'EmptyLatentAudio') {
      entry.inputs.seconds = wv[0] ?? 30;
      entry.inputs.batch_size = wv[1] ?? 1;
    } else if (node.type === 'CheckpointLoaderSimple') {
      entry.inputs.ckpt_name = wv[0] ?? '';
    } else if (node.type === 'CLIPLoader') {
      entry.inputs.clip_name = wv[0] ?? '';
      entry.inputs.type = wv[1] ?? 'stable_audio';
      entry.inputs.device = wv[2] ?? 'default';
    } else if (node.type === 'KSampler') {
      entry.inputs.seed = wv[0] ?? 0;
      entry.inputs.steps = wv[2] ?? 50;
      entry.inputs.cfg = wv[3] ?? 4.98;
      entry.inputs.sampler_name = wv[4] ?? 'dpmpp_3m_sde_gpu';
      entry.inputs.scheduler = wv[5] ?? 'exponential';
      entry.inputs.denoise = wv[6] ?? 1;
    } else if (node.type === 'SaveAudioMP3') {
      entry.inputs.filename_prefix = wv[0] ?? 'ComfyUI';
      entry.inputs.quality = wv[1] ?? 'V0';
    }

    apiPrompt[String(node.id)] = entry;
  }

  return apiPrompt;
}

function injectWorkflowParams(workflow: any, prompt: string, duration: number, seed: number) {
  const apiPrompt = convertWorkflowToApiFormat(workflow);
  const promptNode = apiPrompt['6'];
  if (promptNode) promptNode.inputs.text = prompt;

  const negNode = apiPrompt['7'];
  if (negNode) negNode.inputs.text = '';

  const audioNode = apiPrompt['11'];
  if (audioNode) {
    audioNode.inputs.seconds = duration;
    audioNode.inputs.batch_size = 1;
  }

  const samplerNode = apiPrompt['3'];
  if (samplerNode) samplerNode.inputs.seed = seed;

  return apiPrompt;
}

type PromptRecord = {
  createdAt: number;
  duration: number;
  seed: number;
  fileName: string;
};

const promptStatuses = new Map<string, PromptRecord>();

async function waitForComfyPrompt(clientId: string, promptId: string): Promise<any> {
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!res.ok) continue;
      const data = await res.json();
      const status = data?.[promptId]?.status;
      if (status?.status_str === 'success') return data[promptId];
      if (status?.status_str === 'error') throw new Error(status?.messages?.join('\n') || 'Error en ComfyUI.');
    } catch (e) {
      if ((e as Error).message?.includes('Error en ComfyUI')) throw e;
    }
  }
  throw new Error('Timeout esperando finalizar la generación de audio en ComfyUI.');
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const duration = typeof body?.duration === 'number' ? body.duration : 30;
    const seed = typeof body?.seed === 'number' ? body.seed : Math.floor(Math.random() * 2 ** 32);
    const fileName = typeof body?.fileName === 'string' ? body.fileName : '';

    if (!prompt) return NextResponse.json({ error: 'El prompt es obligatorio' }, { status: 400 });

    const workflow = loadWorkflow();
    const workflowForBackend = injectWorkflowParams(workflow, prompt, duration, seed);

    const clientId = `audio_${Date.now()}`;
    const res = await fetch(`${COMFYUI_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflowForBackend,
        client_id: clientId,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Error enviando prompt a ComfyUI: ${res.status} ${text}`);
    }

    const data = await res.json();
    const promptId = data?.prompt_id;
    if (!promptId) throw new Error('ComfyUI no devolvió prompt_id.');

    promptStatuses.set(promptId, { createdAt: Date.now(), duration, seed, fileName });

    return NextResponse.json({ prompt_id: promptId });
  } catch (e: any) {
    console.error('Error en POST /api/audio-generate:', e);
    return NextResponse.json({ error: e?.message || 'Error generando audio' }, { status: 500 });
  }
}

async function tryDownloadAudio(filename: string, subfolder: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const viewUrl = `${COMFYUI_URL}/api/view?filename=${encodeURIComponent(filename)}&type=output&subfolder=${encodeURIComponent(subfolder)}`;
    const downloadRes = await fetch(viewUrl);
    if (downloadRes.ok) {
      try {
        const arrayBuffer = await downloadRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = downloadRes.headers.get('content-type') || 'audio/mpeg';
        return `data:${mimeType};base64,${base64}`;
      } catch (decodeError) {
        console.error('Error decoding audio data:', decodeError);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const promptId = searchParams.get('prompt_id');
  if (!promptId) return NextResponse.json({ error: 'prompt_id requerido' }, { status: 400 });

  try {
    const record = promptStatuses.get(promptId);
    if (!record) return NextResponse.json({ error: 'prompt_id no registrado o expirado' }, { status: 404 });

    const historyUrl = `${COMFYUI_URL}/history/${encodeURIComponent(promptId)}`;
    const historyRes = await fetch(historyUrl);
    if (!historyRes.ok) {
      return NextResponse.json({ status: 'waiting', progress: 0 });
    }

    const historyJson = await historyRes.json();
    const status = historyJson?.[promptId]?.status;
    const statusStr = status?.status_str;

    if (statusStr === 'success') {
      const outputs = status?.outputs || {};
      let audioFilename: string | null = null;
      let subfolder = '';

      const findAudioFile = (value: any): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some((item) => findAudioFile(item));
        if (value?.filename) {
          audioFilename = String(value.filename);
          subfolder = value.subfolder ? String(value.subfolder) : '';
          return true;
        }
        return Object.values(value).some((v) => findAudioFile(v));
      };

      for (const nodeId of Object.keys(outputs)) {
        if (findAudioFile(outputs[nodeId])) break;
      }

      if (!audioFilename) {
        for (let n = 100; n >= 1; n--) {
          const filename = `ComfyUI_${String(n).padStart(5, '0')}_.mp3`;
          const viewUrl = `${COMFYUI_URL}/api/view?filename=${encodeURIComponent(filename)}&type=output&subfolder=audio`;
          const headRes = await fetch(viewUrl, { method: 'HEAD' });
          if (headRes.ok) {
            audioFilename = filename;
            subfolder = 'audio';
            break;
          }
        }
      }

      if (!audioFilename) {
        console.error('Audio not found. Prompt ID:', promptId, 'History status:', JSON.stringify(status));
        return NextResponse.json({ status: 'error', error: 'No se encontró audio en la salida de ComfyUI.', prompt_id: promptId }, { status: 200 });
      }

      const finalDataUrl = await tryDownloadAudio(audioFilename, subfolder);
      if (!finalDataUrl) {
        return NextResponse.json({ status: 'waiting', progress: 0.9, message: 'Esperando a que el archivo esté disponible...' });
      }

      promptStatuses.delete(promptId);

      return NextResponse.json({
        status: 'success',
        progress: 1,
        url: finalDataUrl,
        fileName: record.fileName || `comfyui_audio_${Date.now()}.mp3`,
      });
    }

    if (statusStr === 'error') {
      promptStatuses.delete(promptId);
      return NextResponse.json({ status: 'error', error: status?.messages?.join('\n') || 'Error en ComfyUI.' }, { status: 200 });
    }

    return NextResponse.json({ status: 'waiting', progress: 0 });
  } catch (e: any) {
    console.error('Error en GET /api/audio-generate:', e);
    return NextResponse.json({ status: 'error', error: e?.message || 'Error consultando estado', details: String(e) }, { status: 200 });
  }
}
