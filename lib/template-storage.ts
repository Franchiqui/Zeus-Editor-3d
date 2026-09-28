import { isElectron, getLocalPaths, readFile, writeFile, deleteFile, ensureDir, listDirectory } from '@/lib/electron-fs';
import { join } from 'path';

export interface SavedTemplate {
  id: string;
  name: string;
  type: 'views' | 'lathe' | 'mesh';
  data: Record<string, unknown>;
  createdAt: number;
}

const STORAGE_KEY = 'zeus_templates';
const TEMPLATES_DIR_NAME = 'templates';

async function getTemplatesFolder(): Promise<string | null> {
  const paths = await getLocalPaths();
  const folder = paths?.objetos_3d;
  if (!folder) return null;
  return join(folder, TEMPLATES_DIR_NAME);
}

function templateFileName(id: string): string {
  return `${id}.zeus-template`;
}

async function loadTemplateFromFile(folder: string, fileName: string): Promise<SavedTemplate | null> {
  try {
    const content = await readFile(join(folder, fileName), 'utf-8');
    if (content) {
      const parsed = JSON.parse(content);
      return parsed as SavedTemplate;
    }
  } catch {}
  return null;
}

async function loadTemplatesFromStorage(): Promise<SavedTemplate[]> {
  if (isElectron()) {
    try {
      const folder = await getTemplatesFolder();
      if (!folder) return _loadFromLocalStorage();

      const created = await ensureDir(folder);
      if (!created) return _loadFromLocalStorage();

      const files = await listDirectory(folder);
      const templates: SavedTemplate[] = [];
      for (const file of files) {
        if (file.name && file.name.endsWith('.zeus-template')) {
          const tpl = await loadTemplateFromFile(folder, file.name);
          if (tpl) templates.push(tpl);
        }
      }
      templates.sort((a, b) => b.createdAt - a.createdAt);
      return templates;
    } catch {
      return _loadFromLocalStorage();
    }
  }
  return _loadFromLocalStorage();
}

function _loadFromLocalStorage(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SavedTemplate[];
    }
  } catch {}
  return [];
}

async function saveSingleTemplateFile(folder: string, template: SavedTemplate): Promise<boolean> {
  try {
    const created = await ensureDir(folder);
    if (!created) return false;
    await writeFile(join(folder, templateFileName(template.id)), JSON.stringify(template, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function saveTemplatesToStorage(templates: SavedTemplate[]): Promise<void> {
  if (isElectron()) {
    try {
      const folder = await getTemplatesFolder();
      if (!folder) {
        _saveToLocalStorage(templates);
        return;
      }
      const created = await ensureDir(folder);
      if (!created) {
        _saveToLocalStorage(templates);
        return;
      }
      for (const tpl of templates) {
        await writeFile(join(folder, templateFileName(tpl.id)), JSON.stringify(tpl, null, 2));
      }
      return;
    } catch {
      _saveToLocalStorage(templates);
    }
  }
  _saveToLocalStorage(templates);
}

function _saveToLocalStorage(templates: SavedTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {}
}

export async function listTemplates(): Promise<SavedTemplate[]> {
  return loadTemplatesFromStorage();
}

export async function saveTemplate(template: Omit<SavedTemplate, 'id' | 'createdAt'>): Promise<SavedTemplate> {
  const templates = await loadTemplatesFromStorage();
  const entry: SavedTemplate = {
    ...template,
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };

  if (isElectron()) {
    const folder = await getTemplatesFolder();
    if (folder && await saveSingleTemplateFile(folder, entry)) {
      return entry;
    }
  }

  templates.push(entry);
  templates.sort((a, b) => b.createdAt - a.createdAt);
  await saveTemplatesToStorage(templates);
  return entry;
}

export async function deleteTemplate(id: string): Promise<void> {
  if (isElectron()) {
    try {
      const folder = await getTemplatesFolder();
      if (folder) {
        await deleteFile(join(folder, templateFileName(id)));
      }
      return;
    } catch {
      const templates = await loadTemplatesFromStorage();
      const filtered = templates.filter((t) => t.id !== id);
      await saveTemplatesToStorage(filtered);
      return;
    }
  }
  const templates = await loadTemplatesFromStorage();
  const filtered = templates.filter((t) => t.id !== id);
  await saveTemplatesToStorage(filtered);
}
