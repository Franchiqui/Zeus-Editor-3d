import { NextRequest, NextResponse } from 'next/server';

const TTS_BASE = 'https://api-texto-a-vox.onrender.com';

type TTSBody = {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
};

/** Lista de voces de la API texto-a-vox (Azure Neural) */
const TTS_VOICES = [
  { Name: 'es-AR-ElenaNeural', Gender: 'Female' },
  { Name: 'es-AR-TomasNeural', Gender: 'Male' },
  { Name: 'es-BO-MarceloNeural', Gender: 'Male' },
  { Name: 'es-BO-SofiaNeural', Gender: 'Female' },
  { Name: 'es-CL-CatalinaNeural', Gender: 'Female' },
  { Name: 'es-CL-LorenzoNeural', Gender: 'Male' },
  { Name: 'es-CO-GonzaloNeural', Gender: 'Male' },
  { Name: 'es-CO-SalomeNeural', Gender: 'Female' },
  { Name: 'es-CU-BelkysNeural', Gender: 'Female' },
  { Name: 'es-CU-ManuelNeural', Gender: 'Male' },
  { Name: 'es-DO-EmilioNeural', Gender: 'Male' },
  { Name: 'es-DO-RamonaNeural', Gender: 'Female' },
  { Name: 'es-EC-AndreaNeural', Gender: 'Female' },
  { Name: 'es-EC-LuisNeural', Gender: 'Male' },
  { Name: 'es-ES-AlvaroNeural', Gender: 'Male' },
  { Name: 'es-ES-ElviraNeural', Gender: 'Female' },
  { Name: 'es-ES-EstrellaNeural', Gender: 'Female' },
  { Name: 'es-ES-LaiaNeural', Gender: 'Female' },
  { Name: 'es-ES-ManuelNeural', Gender: 'Male' },
  { Name: 'es-ES-PelayoNeural', Gender: 'Male' },
  { Name: 'es-GQ-JavierNeural', Gender: 'Male' },
  { Name: 'es-GQ-TeresaNeural', Gender: 'Female' },
  { Name: 'es-GT-AndresNeural', Gender: 'Male' },
  { Name: 'es-GT-MartaNeural', Gender: 'Female' },
  { Name: 'es-HN-CarlosNeural', Gender: 'Male' },
  { Name: 'es-HN-KarlaNeural', Gender: 'Female' },
  { Name: 'es-MX-DaliaNeural', Gender: 'Female' },
  { Name: 'es-MX-JorgeNeural', Gender: 'Male' },
  { Name: 'es-NI-FedericoNeural', Gender: 'Male' },
  { Name: 'es-NI-YolandaNeural', Gender: 'Female' },
  { Name: 'es-PA-MargaritaNeural', Gender: 'Female' },
  { Name: 'es-PA-RobertoNeural', Gender: 'Male' },
  { Name: 'es-PE-CamilaNeural', Gender: 'Female' },
  { Name: 'es-PE-AlexNeural', Gender: 'Male' },
  { Name: 'es-PR-KarinaNeural', Gender: 'Female' },
  { Name: 'es-PR-VictorNeural', Gender: 'Male' },
  { Name: 'es-PY-MarioNeural', Gender: 'Male' },
  { Name: 'es-PY-TaniaNeural', Gender: 'Female' },
  { Name: 'es-SV-LorenaNeural', Gender: 'Female' },
  { Name: 'es-SV-RodrigoNeural', Gender: 'Male' },
  { Name: 'es-US-AlonsoNeural', Gender: 'Male' },
  { Name: 'es-US-PalomaNeural', Gender: 'Female' },
  { Name: 'es-UY-MateoNeural', Gender: 'Male' },
  { Name: 'es-UY-ValentinaNeural', Gender: 'Female' },
  { Name: 'es-VE-PaolaNeural', Gender: 'Female' },
  { Name: 'es-VE-SalvadorNeural', Gender: 'Male' },
];
const VALID_VOICE_NAMES = new Set(TTS_VOICES.map(v => v.Name));

export async function GET() {
  return NextResponse.json({ voices: TTS_VOICES });
}

export async function POST(request: NextRequest) {
  let body: TTSBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 }
    );
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json(
      { error: 'El campo "text" es obligatorio' },
      { status: 400 }
    );
  }

  const voice = typeof body.voice === 'string' && body.voice && VALID_VOICE_NAMES.has(body.voice)
    ? body.voice
    : 'es-ES-AlvaroNeural';

  const rate = typeof body.rate === 'string' ? body.rate : '0%';
  const pitch = typeof body.pitch === 'string' ? body.pitch : '0Hz';
  const volume = typeof body.volume === 'string' ? body.volume : '0%';

  const payload: Record<string, string> = { text, voice };
  if (rate !== '0%') payload.rate = rate;
  if (pitch !== '0Hz') payload.pitch = pitch;
  if (volume !== '0%') payload.volume = volume;

  const customPath = process.env.TTS_API_PATH;
  const paths = customPath
    ? [customPath]
    : ['/textoVoz'];

  const customMethod = process.env.TTS_API_METHOD;

  let res: Response | null = null;
  for (const path of paths) {
    const baseUrl = `${TTS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      if (customMethod === 'GET') {
        const params = new URLSearchParams({
          text,
          voice,
          rate,
          pitch,
          volume,
        });
        res = await fetch(`${baseUrl}?${params}`);
      } else {
        res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
      }
      if (res.ok) break;
    } catch {
      res = null;
    }
  }

  if (!res || !res.ok) {
    const err = res ? await res.text() : 'Error desconocido';
    console.error('TTS Upstream Error:', err);
    return NextResponse.json(
      { error: `Error TTS (Upstream): ${err}` },
      { status: res?.status ?? 502 }
    );
  }

  const contentType = res.headers.get('content-type');
  // Si no es un tipo de audio, es probable que sea un error en formato texto/json con status 200
  if (contentType && !contentType.includes('audio') && !contentType.includes('octet-stream')) {
    const textError = await res.text();
    console.error('TTS Upstream returned non-audio content:', contentType, textError);
    return NextResponse.json(
      { error: `La API de voz devolvió un formato no válido: ${contentType}. Respuesta: ${textError.slice(0, 100)}` },
      { status: 502 }
    );
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 100) {
    return NextResponse.json(
      { error: 'La API de voz devolvió un archivo vacío o demasiado pequeño.' },
      { status: 502 }
    );
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType || 'audio/mpeg',
      'Content-Disposition': 'attachment; filename="tts-audio.mp3"',
    },
  });
}
