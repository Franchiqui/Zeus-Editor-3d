export interface ZeusProject {
    id: string;
    name: string;
    description?: string;
    createdAt?: string;
    updatedAt?: string;
}
export interface Timeline {
    id: string;
    projectId: string;
    tracks: Track[];
    duration: number;
    currentTime: number;
}
export interface Track {
    id: string;
    type: 'video' | 'audio' | 'subtitle';
    name: string;
    clips: Clip[];
}
export interface Clip {
    id: string;
    assetId: string;
    startTime: number;
    duration: number;
}
export interface Asset {
    id: string;
    name: string;
    type: 'video' | 'audio' | 'image';
    path: string;
}
export interface Effect {
    id: string;
    name: string;
    type: 'video' | 'audio';
    category: string;
}
export interface Transition {
    id: string;
    name: string;
    duration: number;
}
