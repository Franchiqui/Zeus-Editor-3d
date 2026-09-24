'use client';
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const ENDPOINTS = [
  {"id":"list-tutorials","method":"GET","path":"/api/tutorials","description":"Obtiene la lista de tutoriales guardados"},
  {"id":"create-tutorial","method":"POST","path":"/api/tutorials","description":"Crea un nuevo tutorial"},
  {"id":"get-tutorial","method":"GET","path":"/api/tutorials/{id}","description":"Obtiene un tutorial por ID"},
  {"id":"update-tutorial","method":"PUT","path":"/api/tutorials/{id}","description":"Actualiza un tutorial existente"},
  {"id":"delete-tutorial","method":"DELETE","path":"/api/tutorials/{id}","description":"Elimina un tutorial"},
  {"id":"generate-tutorial","method":"POST","path":"/api/tutorials/generate","description":"{t('app.apiStartTutorial')}"},
  {"id":"get-generation-status","method":"GET","path":"/api/tutorials/generation/{id}","description":"{t('app.apiGetStatus')}"},
  {"id":"download-tutorial-video","method":"GET","path":"/api/tutorials/{id}/download","description":"Descarga el video MP4 del tutorial generado"},
  {"id":"upload-tutorial-thumbnail","method":"POST","path":"/api/tutorials/{id}/thumbnail","description":"Sube una miniatura para el tutorial"},
  {"id":"list-models","method":"GET","path":"/api/models","description":"Obtiene la lista de modelos de IA configurados"},
  {"id":"create-model","method":"POST","path":"/api/models","description":"Registra un nuevo modelo de IA"},
  {"id":"update-model","method":"PUT","path":"/api/models/{id}","description":"Actualiza un modelo de IA"},
  {"id":"delete-model","method":"DELETE","path":"/api/models/{id}","description":"Elimina un modelo de IA"},
  {"id":"get-settings","method":"GET","path":"/api/settings","description":"{t('app.apiGetConfig')}"},
  {"id":"update-settings","method":"PUT","path":"/api/settings","description":"{t('app.apiUpdateConfig')}"},
  {"id":"get-editor-state","method":"GET","path":"/api/editor/state","description":"Obtiene el estado actual del editor de video"},
  {"id":"update-editor-timeline","method":"PUT","path":"/api/editor/timeline","description":"{t('app.apiUpdateTimeline')}"},
  {"id":"export-edited-video","method":"POST","path":"/api/editor/export","description":"Exporta el video editado a MP4"},
  {"id":"control-mouse","method":"POST","path":"/api/control/mouse","description":"{t('app.apiMoveMouse')}"},
  {"id":"control-keyboard","method":"POST","path":"/api/control/keyboard","description":"{t('app.apiSendKeys')}"},
  {"id":"take-screenshot","method":"POST","path":"/api/control/screenshot","description":"{t('app.apiScreenshot')}"}
];

export default function ApiDashboard() {
  const { t } = useI18n();
  const [params, setParams] = useState<any[]>(new Array(21).fill({}));
  const [results, setResults] = useState<Record<number, any>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const updateParam = (idx: number, key: string, value: any) => {
    setParams(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const testEndpoint = async (idx: number) => {
    setLoading(prev => ({ ...prev, [idx]: true }));
    setErrors(prev => ({ ...prev, [idx]: '' }));
    try {
      const ep = ENDPOINTS[idx];
      let res;
      const headers = { 'Content-Type': 'application/json' };
      
      switch (idx) {
        case 0: res = await fetch(`${BASE_URL}/api/tutorials`, { method: 'GET', headers }); break;
        case 1: res = await fetch(`${BASE_URL}/api/tutorials`, { method: 'POST', headers, body: JSON.stringify(params[1]) }); break;
        case 2: res = await fetch(`${BASE_URL}/api/tutorials/${params[2].id || ''}`, { method: 'GET', headers }); break;
        case 3: res = await fetch(`${BASE_URL}/api/tutorials/${params[3].id || ''}`, { method: 'PUT', headers, body: JSON.stringify(params[3]) }); break;
        case 4: res = await fetch(`${BASE_URL}/api/tutorials/${params[4].id || ''}`, { method: 'DELETE', headers }); break;
        case 5: res = await fetch(`${BASE_URL}/api/tutorials/generate`, { method: 'POST', headers, body: JSON.stringify(params[5]) }); break;
        case 6: res = await fetch(`${BASE_URL}/api/tutorials/generation/${params[6].id || ''}`, { method: 'GET', headers }); break;
        case 7: res = await fetch(`${BASE_URL}/api/tutorials/${params[7].id || ''}/download`, { method: 'GET', headers }); break;
        case 8: res = await fetch(`${BASE_URL}/api/tutorials/${params[8].id || ''}/thumbnail`, { method: 'POST', headers, body: JSON.stringify(params[8]) }); break;
        case 9: res = await fetch(`${BASE_URL}/api/models`, { method: 'GET', headers }); break;
        case 10: res = await fetch(`${BASE_URL}/api/models`, { method: 'POST', headers, body: JSON.stringify(params[10]) }); break;
        case 11: res = await fetch(`${BASE_URL}/api/models/${params[11].id || ''}`, { method: 'PUT', headers, body: JSON.stringify(params[11]) }); break;
        case 12: res = await fetch(`${BASE_URL}/api/models/${params[12].id || ''}`, { method: 'DELETE', headers }); break;
        case 13: res = await fetch(`${BASE_URL}/api/settings`, { method: 'GET', headers }); break;
        case 14: res = await fetch(`${BASE_URL}/api/settings`, { method: 'PUT', headers, body: JSON.stringify(params[14]) }); break;
        case 15: res = await fetch(`${BASE_URL}/api/editor/state`, { method: 'GET', headers }); break;
        case 16: res = await fetch(`${BASE_URL}/api/editor/timeline`, { method: 'PUT', headers, body: JSON.stringify(params[16]) }); break;
        case 17: res = await fetch(`${BASE_URL}/api/editor/export`, { method: 'POST', headers, body: JSON.stringify(params[17]) }); break;
        case 18: res = await fetch(`${BASE_URL}/api/control/mouse`, { method: 'POST', headers, body: JSON.stringify(params[18]) }); break;
        case 19: res = await fetch(`${BASE_URL}/api/control/keyboard`, { method: 'POST', headers, body: JSON.stringify(params[19]) }); break;
        case 20: res = await fetch(`${BASE_URL}/api/control/screenshot`, { method: 'POST', headers, body: JSON.stringify(params[20]) }); break;
      }
      
      if (!res?.ok) throw new Error(`${ep.method} ${ep.path} failed: ${res?.status}`);
      const data = await res.json();
      setResults(prev => ({ ...prev, [idx]: data }));
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [idx]: err.message || 'Error' }));
    } finally {
      setLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  return (
    <div className="p-6 bg-background text-foreground/90 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">API Dashboard</h1>
      <p className="text-muted-foreground mb-6">Editor tutoriales Zeus IA — {ENDPOINTS.length} endpoints disponibles</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border border-border/80 rounded-lg">
          <thead className="bg-background">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">{t('app.method')}</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Path</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">{t('app.description')}</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">{t('app.action')}</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((ep, idx) => (
              <tr key={ep.id} className="border-b border-border/80">
                <td className="px-3 py-2 text-sm">
                  <span className={cn(
                    "inline-block px-2 py-0.5 rounded text-xs font-bold",
                    ep.method === 'GET' ? "bg-green-900/30 text-green-400" :
                    ep.method === 'POST' ? "bg-blue-900/30 text-blue-400" :
                    ep.method === 'PUT' ? "bg-yellow-900/30 text-yellow-400" :
                    "bg-red-900/30 text-red-400"
                  )}>
                    {ep.method}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm text-foreground/70 font-mono">
                  {ep.path}
                </td>
                <td className="px-3 py-2 text-sm text-muted-foreground">
                  {ep.description}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-2">
                    {ep.path.includes('{id}') && (
                      <input
                        type="text"
                        placeholder="ID"
                        value={params[idx].id || ''}
                        onChange={(e) => updateParam(idx, 'id', e.target.value)}
                        className="bg-card border border-border/50 rounded px-2 py-1 text-xs"
                      />
                    )}
                    {ep.method !== 'GET' && ep.method !== 'DELETE' && (
                      <textarea
                        placeholder="Cuerpo JSON"
                        value={typeof params[idx] === 'object' ? JSON.stringify(params[idx], null, 2) : params[idx]}
                        onChange={(e) => {
                          try {
                            updateParam(idx, 'data', JSON.parse(e.target.value));
                          } catch {
                            updateParam(idx, 'data', e.target.value);
                          }
                        }}
                        className="bg-card border border-border/50 rounded px-2 py-1 text-xs font-mono h-20"
                      />
                    )}
                    <button 
                      onClick={() => testEndpoint(idx)} 
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                      disabled={loading[idx]}
                    >
                      {loading[idx] ? 'Ejecutando...' : 'Probar'}
                    </button>
                    {results[idx] && (
                      <div className="mt-2 text-[10px] bg-black/40 border border-border/50 rounded p-2 max-h-32 overflow-auto">
                        <pre className="text-green-400">{JSON.stringify(results[idx], null, 2)}</pre>
                      </div>
                    )}
                    {errors[idx] && (
                      <div className="mt-2 text-[10px] text-red-400 font-medium">
                        {errors[idx]}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
