import { ZeusProject, Timeline, Asset, Effect, Transition } from './types';

export class ZeusMultieditorAPI {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:4001') {
    this.baseUrl = baseUrl;
  }

  // Projects
  async getProjects(): Promise<ZeusProject[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects`);
    return response.json();
  }

  async getProject(id: string): Promise<ZeusProject> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${id}`);
    return response.json();
  }

  async createProject(project: Partial<ZeusProject>): Promise<ZeusProject> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
    return response.json();
  }

  async updateProject(id: string, project: Partial<ZeusProject>): Promise<ZeusProject> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
    return response.json();
  }

  async deleteProject(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/projects/${id}`, {
      method: 'DELETE'
    });
  }

  // Timeline
  async getTimeline(projectId: string): Promise<Timeline> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline`);
    return response.json();
  }

  async insertClip(projectId: string, clip: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clip)
    });
    return response.json();
  }

  async updateClip(projectId: string, clipId: string, clip: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips/${clipId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clip)
    });
    return response.json();
  }

  async deleteClip(projectId: string, clipId: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips/${clipId}`, {
      method: 'DELETE'
    });
  }

  // Assets
  async getAssets(): Promise<Asset[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/assets`);
    return response.json();
  }

  async getAsset(id: string): Promise<Asset> {
    const response = await fetch(`${this.baseUrl}/api/v1/assets/${id}`);
    return response.json();
  }

  async uploadAsset(file: File): Promise<Asset> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/v1/assets/upload`, {
      method: 'POST',
      body: formData
    });
    return response.json();
  }

  // Effects
  async getEffects(): Promise<Effect[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/effects`);
    return response.json();
  }

  async applyEffect(projectId: string, effect: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/effects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effect)
    });
    return response.json();
  }

  // Transitions
  async getTransitions(): Promise<Transition[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/transitions`);
    return response.json();
  }

  async applyTransition(projectId: string, transition: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transition)
    });
    return response.json();
  }

  // Text
  async addText(projectId: string, text: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text)
    });
    return response.json();
  }

  async getStyles(): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/styles`);
    return response.json();
  }

  // AI
  async generateScript(scriptRequest: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scriptRequest)
    });
    return response.json();
  }

  async getSuggestions(request: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    return response.json();
  }

  async autoEdit(projectId: string, options: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/auto-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    return response.json();
  }

  // Files
  async listFiles(folder: string, category?: string): Promise<any[]> {
    const params = new URLSearchParams();
    params.append('folder', folder);
    if (category) params.append('category', category);
    
    const response = await fetch(`${this.baseUrl}/api/local/list?${params.toString()}`);
    const data = await response.json();
    return data.files || [];
  }

  async viewFileUrl(filePath: string): Promise<string> {
    return `${this.baseUrl}/api/local/view?f=${encodeURIComponent(filePath)}`;
  }

  async deleteFile(path: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/local/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
  }

  // Export
  async exportProject(projectId: string, exportOptions: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportOptions)
    });
    return response.json();
  }

  async getExportStatus(jobId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/exports/${jobId}`);
    return response.json();
  }

  async downloadExport(jobId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v1/exports/${jobId}/download`);
    return response.json();
  }
}
