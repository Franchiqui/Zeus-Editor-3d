import React, { createContext, useContext, useState } from 'react';

interface EditorContextType {
  // Editor state
  selectedTool: string;
  zoomLevel: number;
  isDragging: boolean;
  
  // Editor actions
  setSelectedTool: (tool: string) => void;
  setZoomLevel: (level: number) => void;
  setIsDragging: (dragging: boolean) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [selectedTool, setSelectedTool] = useState('select');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  const value = {
    selectedTool,
    zoomLevel,
    isDragging,
    setSelectedTool,
    setZoomLevel,
    setIsDragging
  };

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}