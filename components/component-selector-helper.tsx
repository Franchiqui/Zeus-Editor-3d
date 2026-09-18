/**
 * Component Selector Helper para Next.js
 * 
 * Agrega este componente a tu layout.tsx para habilitar la selección de componentes
 * desde el editor visual.
 */

'use client';

import { useEffect } from 'react';

// Debounce mechanism to prevent rapid repeated calls
let lastGenerationTime = 0;
const GENERATION_COOLDOWN = 2000; // 2 seconds

// 🔥 NUEVO: Estado para el tipo de componente seleccionado
let currentComponentType: 'background' | 'text' | 'image' | 'layout' | 'button' | 'all' = 'all';

// 🔥 NUEVO: Función de logging mejorada para debugging
const debugLog = (message: string, _data?: any) => {
  const logMessage = `[component-selector-helper] ${message}`;

  console.log(logMessage);

  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window && window.parent.postMessage) {
      window.parent.postMessage({
        type: 'debugLog',
        message: logMessage
      }, '*');
    }
  } catch (error) {
    console.warn('[component-selector-helper] No se pudo enviar log al padre:', error);
  }
};

export function ComponentSelectorHelper() {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'componentTypeChanged') {
        currentComponentType = event.data.componentType;
        console.log('[component-selector-helper] 🔄 Tipo de componente actualizado:', currentComponentType);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    const isInIframe = window.self !== window.top;

    if (!isInIframe) {
      const applyIdsFromImportedCSSStandalone = async () => {
        let cssContent = '';

        const styleElement = document.getElementById('zeus-component-styles');
        if (styleElement && styleElement.textContent) {
          cssContent = styleElement.textContent;
        } else {
          const allStyles = Array.from(document.querySelectorAll('style'));
          for (const style of allStyles) {
            if (style.textContent &&
              (style.textContent.includes('data-component-id') ||
                style.textContent.includes('zeus'))) {
              cssContent = style.textContent;
              console.log('[component-selector-helper] CSS encontrado en elemento <style>');
              break;
            }
          }
        }

        if (!cssContent) {
          try {
            const cssLink = document.querySelector('link[href*="zeus-styles.css"]') as HTMLLinkElement;
            if (cssLink && cssLink.href) {
              const response = await fetch(cssLink.href);
              if (response.ok) {
                cssContent = await response.text();
                console.log('[component-selector-helper] CSS leído desde archivo importado');
              }
            }
          } catch (e) {
            console.warn('[component-selector-helper] No se pudo leer CSS desde archivo (puede ser CORS):', e);
          }
        }

        if (!cssContent) {
          try {
            for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
              try {
                const sheet = document.styleSheets[sheetIndex];
                const rules = sheet.cssRules || sheet.rules;
                if (rules) {
                  for (let i = 0; i < rules.length; i++) {
                    const rule = rules[i] as CSSStyleRule;
                    if (rule.selectorText && rule.selectorText.includes('data-component-id')) {
                      cssContent += rule.selectorText + ' {\n';
                      for (let j = 0; j < rule.style.length; j++) {
                        const prop = rule.style[j];
                        cssContent += `  ${prop}: ${rule.style.getPropertyValue(prop)} !important;\n`;
                      }
                      cssContent += '}\n\n';
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }
            if (cssContent) {
              console.log('[component-selector-helper] CSS reconstruido desde reglas CSS aplicadas');
            }
          } catch (e) {
            console.warn('[component-selector-helper] No se pudo leer CSS desde reglas:', e);
          }
        }

        if (cssContent) {
          console.log('[component-selector-helper] Modo standalone: Aplicando IDs desde CSS importado...');
          const componentIdMatches = cssContent.matchAll(/\[data-component-id="([^"]+)"\]/g);
          const componentIdsInCSS = Array.from(componentIdMatches, m => m[1]);

          console.log(`[component-selector-helper] Encontrados ${componentIdsInCSS.length} IDs en CSS:`, componentIdsInCSS);

          componentIdsInCSS.forEach(componentId => {
            let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

            if (!element) {
              const { classPart, pathPart } = parseComponentId(componentId);

              console.log(`[component-selector-helper] Buscando elemento para ID "${componentId}", clase extraída: "${classPart}"`);

              if (classPart) {
                let foundElement: HTMLElement | null = null;

                const isSpecialComponent = (() => {
                  const generalSelectors = [
                    `[data-component-id*="${componentId}"]`,
                    `#${componentId}`,
                    `[class*="${componentId}"]`,
                    `h1, h2, h3, h4, h5, h6`,
                    `section`,
                    `div[class*="section"]`,
                    `div[class*="container"]`,
                    `p`,
                    `span`,
                    `div`
                  ];

                  for (const selector of generalSelectors) {
                    try {
                      const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                      for (const el of elements) {
                        const text = el.textContent?.toLowerCase() || '';
                        const className = el.className?.toLowerCase() || '';
                        const elementId = el.id?.toLowerCase() || '';

                        if (text.includes(componentId) ||
                          className.includes(componentId) ||
                          elementId.includes(componentId)) {
                          return true;
                        }
                      }
                    } catch (e) {
                      // Ignorar errores
                    }
                  }
                  return false;
                })();

                if (isSpecialComponent) {
                  const semanticSelectors = [
                    `[data-component-id*="${componentId}"]`,
                    `#${componentId}`,
                    `[class*="${componentId}"]`,
                    `h1, h2, h3, h4, h5, h6`,
                    `section`,
                    `div[class*="section"]`,
                    `div[class*="container"]`,
                  ];

                  for (const selector of semanticSelectors) {
                    try {
                      const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                      for (const el of elements) {
                        const text = el.textContent?.toLowerCase() || '';
                        const className = el.className?.toLowerCase() || '';
                        const elementId = el.id?.toLowerCase() || '';

                        if (text.includes(componentId) ||
                          className.includes(componentId) ||
                          elementId.includes(componentId)) {
                          foundElement = el;
                          console.log(`[component-selector-helper] 🎯 Encontrado elemento semántico para "${componentId}":`, el.tagName, el.className);
                          break;
                        }
                      }
                      if (foundElement) break;
                    } catch (e) {
                      // Ignorar errores
                    }
                  }
                }

                if (!foundElement) {
                  const classSelectors = [
                    `.${classPart}`,
                    `[class*="${classPart}"]`,
                    `[class*="${classPart.replace(/-/g, '')}"]`,
                    `[class*="${classPart.split('-')[0]}"]`
                  ];

                  const candidates: HTMLElement[] = [];
                  for (const selector of classSelectors) {
                    try {
                      const found = document.querySelectorAll(selector);
                      found.forEach((el) => {
                        const htmlEl = el as HTMLElement;
                        if (!htmlEl.hasAttribute('data-component-id') &&
                          !['BODY', 'HTML', 'HEAD', 'SCRIPT', 'STYLE'].includes(htmlEl.tagName)) {
                          candidates.push(htmlEl);
                        }
                      });
                    } catch (e) {
                      // Ignorar errores
                    }
                  }

                  console.log(`[component-selector-helper] Encontrados ${candidates.length} candidatos para "${classPart}"`);

                  if (candidates.length > 0 && pathPart) {
                    const pathFromId = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();

                    for (const candidate of candidates) {
                      const candidatePath = generatePathHash(candidate);
                      const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                      const normalizedPathFromId = pathFromId.replace(/--+/g, '-').replace(/^-|-$/g, '');

                      if (candidates.length === 1 ||
                        normalizedCandidatePath === normalizedPathFromId ||
                        normalizedPathFromId.includes(normalizedCandidatePath) ||
                        normalizedCandidatePath.includes(normalizedPathFromId)) {
                        foundElement = candidate;
                        break;
                      }
                    }
                  }

                  if (!foundElement && candidates.length > 0) {
                    foundElement = candidates.find(c => !c.hasAttribute('data-component-id')) || candidates[0];
                  }
                }

                if (foundElement) {
                  foundElement.setAttribute('data-component-id', componentId);
                  console.log(`[component-selector-helper] ✅ ID "${componentId}" aplicado a elemento:`, foundElement.tagName, foundElement.className || foundElement.id);
                } else {
                  if (isSpecialComponent) {
                    console.log(`[component-selector-helper] 🆘 Búsqueda de emergencia por texto para "${componentId}"`);

                    const textSelectors = [
                      `*[data-component-id*="${componentId}"]`,
                      `*[class*="${componentId}"]`,
                      `*[id*="${componentId}"]`
                    ];

                    for (const selector of textSelectors) {
                      try {
                        const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                        for (const el of elements) {
                          const text = el.textContent?.toLowerCase() || '';
                          const className = el.className?.toLowerCase() || '';
                          const elementId = el.id?.toLowerCase() || '';

                          if (text.includes(componentId) ||
                            className.includes(componentId) ||
                            elementId.includes(componentId)) {
                            foundElement = el;
                            console.log(`[component-selector-helper] 🎯 Encontrado elemento por texto:`, el.tagName, el.className);
                            break;
                          }
                        }
                        if (foundElement) break;
                      } catch (e) {
                        // Ignorar errores
                      }
                    }
                  }
                }
              }
            }
          });
        }
      };

      applyIdsFromImportedCSSStandalone();
    }
  }, []);

  return null;
}

function parseComponentId(componentId: string): { classPart: string; pathPart: string } {
  const parts = componentId.split('--');
  const classPart = parts[0] || '';
  const pathPart = parts.slice(1).join('--');
  return { classPart, pathPart };
}

function generatePathHash(element: HTMLElement): string {
  const className = element.className;
  const id = element.id;
  const tagName = element.tagName.toLowerCase();
  const attributes = Array.from(element.attributes)
    .map(attr => attr.name)
    .sort()
    .join('-');
  return `${tagName}-${className}-${id}-${attributes}`;
}
