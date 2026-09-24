'use client';

import { useState, useCallback, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { LightConfig, SpotlightConfig } from '@/components/viewer-3d';
import {
  Sun,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Move3D,
  Palette,
  Eye,
  EyeOff,
} from 'lucide-react';

interface LightingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lightConfig: LightConfig | null;
  onSave: (config: LightConfig) => void;
}

const DEFAULT_AMBIENT_COLOR = 0xffffff;
const DEFAULT_AMBIENT_INTENSITY = 0.9;

export default function LightingModal({
  isOpen,
  onClose,
  lightConfig,
  onSave,
}: LightingModalProps) {
  const [config, setConfig] = useState<LightConfig>({
    ambient: {
      enabled: true,
      color: DEFAULT_AMBIENT_COLOR,
      intensity: DEFAULT_AMBIENT_INTENSITY,
    },
    spotlights: [],
  });

  useEffect(() => {
    if (lightConfig) {
      setConfig(lightConfig);
    }
  }, [lightConfig]);

  const updateAmbient = useCallback((patch: Partial<typeof config.ambient>) => {
    setConfig((prev) => ({
      ...prev,
      ambient: { ...prev.ambient, ...patch },
    }));
  }, []);

  const addSpotlight = useCallback(() => {
    const newSpot: SpotlightConfig = {
      id: `spot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      enabled: true,
      position: { x: 0, y: 5, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      color: 0xffffff,
      intensity: 2,
      angle: Math.PI / 3,
      penumbra: 0.5,
      castShadow: false,
      shadowIntensity: 0.5,
      shadowColor: 0x000000,
      helperVisible: true,
    };
    setConfig((prev) => ({
      ...prev,
      spotlights: [...prev.spotlights, newSpot],
    }));
  }, []);

  const removeSpotlight = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      spotlights: prev.spotlights.filter((s) => s.id !== id),
    }));
  }, []);

  const updateSpotlight = useCallback((id: string, patch: Partial<Omit<SpotlightConfig, 'id'>>) => {
    setConfig((prev) => ({
      ...prev,
      spotlights: prev.spotlights.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    }));
  }, []);

  const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');
  const fromHex = (h: string) => parseInt(h.replace('#', ''), 16);

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const handleReset = () => {
    setConfig({
      ambient: {
        enabled: true,
        color: DEFAULT_AMBIENT_COLOR,
        intensity: DEFAULT_AMBIENT_INTENSITY,
      },
      spotlights: [],
    });
  };

  return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Configuración de luces"
        description="Ajusta la luz ambiente y los focos. Haz clic en Guardar para aplicar a la escena 3D. Arrastra los focos directamente en la vista 3D (Shift= X, Alt= Y, Ctrl= Z)"
        size="lg"
        bodyClassName="thin-scrollbar-nobg"
      >
        <ModalBody className="space-y-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sun className="w-4 h-4 text-amber-400" />
          Luz ambiente
        </div>
        {config.spotlights.length === 0 && !config.ambient.enabled && (
          <div className="text-xs text-muted-foreground/60 bg-black/20 rounded p-2 mb-2">
            La luz ambiente está desactivada. Actívala o añade un foco para iluminar la escena 3D.
          </div>
        )}

        {/* Ambient light controls */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={config.ambient.enabled}
                onChange={(e) => updateAmbient({ enabled: e.target.checked })}
                className="w-3 h-3 accent-green-500 cursor-pointer"
              />
              Activada
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="color"
              value={hexColor(config.ambient.color)}
              onChange={(e) =>
                updateAmbient({ color: fromHex(e.target.value) })
              }
              className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
              title="Color de la luz ambiente"
            />
            <div
              className="w-16 h-6 rounded border border-white/10"
              style={{ backgroundColor: hexColor(config.ambient.color) }}
            />
          </div>

          <div className="space-y-2">
            <label className="flex justify-between text-xs text-muted-foreground">
              <span>Intensidad</span>
              <span className="font-mono text-green-400">
                {config.ambient.intensity.toFixed(1)}
              </span>
            </label>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[config.ambient.intensity]}
              onValueChange={([v]) => updateAmbient({ intensity: v })}
              className="w-full"
            />
          </div>
        </div>

        {/* Spotlights section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Move3D className="w-4 h-4 text-blue-400" />
              Focos
            </div>
             <Button
               variant="outline"
               size="sm"
               onClick={addSpotlight}
               className="text-xs"
             >
               <Plus className="w-3 h-3 mr-1" />
               Añadir foco
             </Button>
          </div>
           <div className="text-xs text-muted-foreground/50 -mt-1">
             Arrastra los focos en la vista 3D. Mantén <kbd className="px-1.5 py-0.5 text-[10px] bg-black/30 rounded">Shift</kbd> = X, <kbd className="px-1.5 py-0.5 text-[10px] bg-black/30 rounded">Alt</kbd> = Y, <kbd className="px-1.5 py-0.5 text-[10px] bg-black/30 rounded">Ctrl</kbd> = Z
           </div>

          {config.spotlights.length === 0 ? (
            <div className="text-xs text-muted-foreground/60 text-center py-4">
              No hay focos configurados. Haz clic en "Añadir" para crear uno.
            </div>
          ) : (
            <div className="space-y-4">
              {config.spotlights.map((spot) => (
                <div
                  key={spot.id}
                  className="p-3 rounded-md bg-black/30 border border-white/5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        onClick={() =>
                          updateSpotlight(spot.id, {
                            enabled: !spot.enabled,
                          })
                        }
                        className="p-0 hover:bg-transparent"
                        title={spot.enabled ? 'Desactivar' : 'Activar'}
                      >
                        {spot.enabled ? (
                          <ToggleRight className="w-4 h-4 text-green-400" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                        )}
                    </button>
                       Activo
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          updateSpotlight(spot.id, {
                            helperVisible: spot.helperVisible === false,
                          })
                        }
                        className="p-0.5 hover:bg-gray-700 rounded"
                        title={
                          spot.helperVisible === false
                            ? 'Mostrar ayuda visual'
                            : 'Ocultar ayuda visual'
                        }
                        disabled={!spot.enabled}
                      >
                        {spot.helperVisible === false ? (
                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-amber-400" />
                        )}
                      </button>
                      <button
                        onClick={() => removeSpotlight(spot.id)}
                        className="p-1 rounded text-red-400 hover:bg-red-500/20"
                        title="Eliminar foco"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Position controls */}
                  <div className="space-y-2">
                    <label className="flex justify-between text-xs text-muted-foreground">
                      <span>Posición</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground/60">X</label>
                        <input
                          type="number"
                          step={0.1}
                          value={spot.position.x.toFixed(1)}
                          onChange={(e) =>
                            updateSpotlight(spot.id, {
                              position: {
                                ...spot.position,
                                x: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full text-xs px-2 py-1 bg-black/40 border border-white/10 rounded"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground/60">Y</label>
                        <input
                          type="number"
                          step={0.1}
                          value={spot.position.y.toFixed(1)}
                          onChange={(e) =>
                            updateSpotlight(spot.id, {
                              position: {
                                ...spot.position,
                                y: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full text-xs px-2 py-1 bg-black/40 border border-white/10 rounded"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground/60">Z</label>
                        <input
                          type="number"
                          step={0.1}
                          value={spot.position.z.toFixed(1)}
                          onChange={(e) =>
                            updateSpotlight(spot.id, {
                              position: {
                                ...spot.position,
                                z: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full text-xs px-2 py-1 bg-black/40 border border-white/10 rounded"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Color + Intensity */}
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={hexColor(spot.color)}
                      onChange={(e) =>
                        updateSpotlight(spot.id, {
                          color: fromHex(e.target.value),
                        })
                      }
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-muted-foreground/60">
                        <span>Intensidad</span>
                        <span className="font-mono text-blue-400">
                          {spot.intensity.toFixed(1)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={10}
                        step={0.25}
                        value={[spot.intensity]}
                        onValueChange={([v]) =>
                          updateSpotlight(spot.id, { intensity: v })
                        }
                        className="w-full"
                      />
                    </div>
                  </div>

                   {/* Angle / beam diameter */}
                   <div className="space-y-2">
                     <label className="flex justify-between text-xs text-muted-foreground">
                       <span>Diámetro haz</span>
                       <span className="font-mono text-blue-400">
                         {Math.round((spot.angle * 180) / Math.PI)}°
                       </span>
                     </label>
                    <Slider
                      min={0.1}
                      max={Math.PI / 2}
                      step={0.05}
                      value={[spot.angle]}
                      onValueChange={([v]) =>
                        updateSpotlight(spot.id, { angle: v })
                      }
                      className="w-full"
                    />
                  </div>

                   {/* Penumbra */}
                   <div className="space-y-2">
                     <label className="flex justify-between text-xs text-muted-foreground">
                       <span>Penumbra</span>
                       <span className="font-mono text-blue-400">
                         {spot.penumbra.toFixed(1)}
                       </span>
                     </label>
                     <Slider
                       min={0}
                       max={1}
                       step={0.05}
                       value={[spot.penumbra]}
                       onValueChange={([v]) =>
                         updateSpotlight(spot.id, { penumbra: v })
                       }
                       className="w-full"
                     />
                   </div>

                   {/* Shadow controls */}
                   <div className="space-y-3 pt-2 border-t border-white/5">
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-xs text-muted-foreground">
                         <span className="w-3 h-3 rounded-full bg-gray-400" />
                         Proyectar sombra
                       </label>
                       <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer">
                         <input
                           type="checkbox"
                           checked={spot.castShadow ?? false}
                           onChange={(e) =>
                             updateSpotlight(spot.id, {
                               castShadow: e.target.checked,
                             })
                           }
                           className="sr-only"
                         />
                         <div
                           className={`h-5 w-9 rounded-full transition-colors ${
                             spot.castShadow ? 'bg-blue-500' : 'bg-gray-600'
                           }`}
                         >
                           <div
                             className={`h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${
                               spot.castShadow ? 'translate-x-4' : 'translate-x-0.5'
                             }`}
                           />
                         </div>
                       </label>
                     </div>

                     {spot.castShadow && (
                       <>
                         {/* Shadow intensity */}
                         <div className="space-y-2">
                           <label className="flex justify-between text-xs text-muted-foreground">
                             <span>Intensidad sombra</span>
                             <span className="font-mono text-blue-400">
                               {(spot.shadowIntensity ?? 0.5).toFixed(2)}
                             </span>
                           </label>
                           <Slider
                             min={0}
                             max={1}
                             step={0.05}
                             value={[spot.shadowIntensity ?? 0.5]}
                             onValueChange={([v]) =>
                               updateSpotlight(spot.id, { shadowIntensity: v })
                             }
                             className="w-full"
                           />
                         </div>

                         {/* Shadow color */}
                         <div className="flex items-center gap-3">
                           <input
                             type="color"
                             value={hexColor(spot.shadowColor ?? 0x000000)}
                             onChange={(e) =>
                               updateSpotlight(spot.id, {
                                 shadowColor: fromHex(e.target.value),
                               })
                             }
                             className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                             title="Color de la sombra"
                           />
                           <div
                             className="w-16 h-6 rounded border border-white/10"
                             style={{
                               backgroundColor: hexColor(spot.shadowColor ?? 0x000000),
                             }}
                           />
                         </div>
                       </>
                     )}
                   </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="text-xs"
        >
          Restablecer
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          className="text-xs"
        >
          Guardar
        </Button>
      </ModalFooter>
    </Modal>
  );
}
