"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeusMultieditorAPI = void 0;
class ZeusMultieditorAPI {
    constructor(baseUrl = 'http://localhost:4001') {
        this.baseUrl = baseUrl;
    }
    // Projects
    async getProjects() {
        const response = await fetch(`${this.baseUrl}/api/v1/projects`);
        return response.json();
    }
    async getProject(id) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${id}`);
        return response.json();
    }
    async createProject(project) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(project)
        });
        return response.json();
    }
    async updateProject(id, project) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(project)
        });
        return response.json();
    }
    async deleteProject(id) {
        await fetch(`${this.baseUrl}/api/v1/projects/${id}`, {
            method: 'DELETE'
        });
    }
    // Timeline
    async getTimeline(projectId) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline`);
        return response.json();
    }
    async insertClip(projectId, clip) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clip)
        });
        return response.json();
    }
    async updateClip(projectId, clipId, clip) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips/${clipId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clip)
        });
        return response.json();
    }
    async deleteClip(projectId, clipId) {
        await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/timeline/clips/${clipId}`, {
            method: 'DELETE'
        });
    }
    // Assets
    async getAssets() {
        const response = await fetch(`${this.baseUrl}/api/v1/assets`);
        return response.json();
    }
    async getAsset(id) {
        const response = await fetch(`${this.baseUrl}/api/v1/assets/${id}`);
        return response.json();
    }
    async uploadAsset(file) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/v1/assets/upload`, {
            method: 'POST',
            body: formData
        });
        return response.json();
    }
    // Effects
    async getEffects() {
        const response = await fetch(`${this.baseUrl}/api/v1/effects`);
        return response.json();
    }
    async applyEffect(projectId, effect) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/effects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(effect)
        });
        return response.json();
    }
    // Transitions
    async getTransitions() {
        const response = await fetch(`${this.baseUrl}/api/v1/transitions`);
        return response.json();
    }
    async applyTransition(projectId, transition) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/transitions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transition)
        });
        return response.json();
    }
    // Text
    async addText(projectId, text) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(text)
        });
        return response.json();
    }
    async getStyles() {
        const response = await fetch(`${this.baseUrl}/api/v1/styles`);
        return response.json();
    }
    // AI
    async generateScript(scriptRequest) {
        const response = await fetch(`${this.baseUrl}/api/v1/ai/script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scriptRequest)
        });
        return response.json();
    }
    async getSuggestions(request) {
        const response = await fetch(`${this.baseUrl}/api/v1/ai/suggestions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        return response.json();
    }
    async autoEdit(projectId, options) {
        const response = await fetch(`${this.baseUrl}/api/v1/ai/auto-edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options)
        });
        return response.json();
    }
    // Files
    async listFiles(folder, category) {
        const params = new URLSearchParams();
        params.append('folder', folder);
        if (category)
            params.append('category', category);
        const response = await fetch(`${this.baseUrl}/api/local/list?${params.toString()}`);
        const data = await response.json();
        return data.files || [];
    }
    async viewFileUrl(filePath) {
        return `${this.baseUrl}/api/local/view?f=${encodeURIComponent(filePath)}`;
    }
    async deleteFile(path) {
        await fetch(`${this.baseUrl}/api/local/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
    }
    // Export
    async exportProject(projectId, exportOptions) {
        const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportOptions)
        });
        return response.json();
    }
    async getExportStatus(jobId) {
        const response = await fetch(`${this.baseUrl}/api/v1/exports/${jobId}`);
        return response.json();
    }
    async downloadExport(jobId) {
        const response = await fetch(`${this.baseUrl}/api/v1/exports/${jobId}/download`);
        return response.json();
    }
}
exports.ZeusMultieditorAPI = ZeusMultieditorAPI;
