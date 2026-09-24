'use client';

import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Trash2, RotateCw, FlipHorizontal, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FrameData } from '@/lib/gif-utils';

interface FrameItemProps {
  frame: FrameData;
  index: number;
  onDelete: (id: string) => void;
  onRotate: (id: string) => void;
  onFlip: (id: string) => void;
  onCleanSelection: (id: string) => void;
}

function FrameItem({ frame, index, onDelete, onRotate, onFlip, onCleanSelection }: FrameItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card className="p-2 cursor-move hover:shadow-md transition-shadow">
        <div className="relative group">
          <img
            src={frame.thumbnail}
            alt={`Frame ${index + 1}`}
            className="w-full h-32 object-cover rounded"
            {...listeners}
          />
          <div className="absolute top-1 left-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
            #{index + 1}
          </div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRotate(frame.id)}
              className="h-8 w-8 p-0"
            >
              <RotateCw className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onFlip(frame.id)}
              className="h-8 w-8 p-0"
            >
              <FlipHorizontal className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCleanSelection(frame.id)}
              className="h-8 w-8 p-0 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white"
              title="Limpiar selección"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onDelete(frame.id)}
              className="h-8 w-8 p-0"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-600 text-center">
          {frame.duration}ms
        </div>
      </Card>
    </div>
  );
}

interface FrameListProps {
  frames: FrameData[];
  onReorder: (newFrames: FrameData[]) => void;
  onDelete: (id: string) => void;
  onRotate: (id: string) => void;
  onFlip: (id: string) => void;
  onCleanSelection: (id: string) => void;
}

export function FrameList({ frames, onReorder, onDelete, onRotate, onFlip, onCleanSelection }: FrameListProps) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = frames.findIndex((f) => f.id === active.id);
      const newIndex = frames.findIndex((f) => f.id === over.id);

      const newFrames = [...frames];
      const [movedFrame] = newFrames.splice(oldIndex, 1);
      newFrames.splice(newIndex, 0, movedFrame);

      onReorder(newFrames);
    }
  };

  if (frames.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No frames yet. Add some images to get started!</p>
      </div>
    );
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={frames.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {frames.map((frame, index) => (
            <FrameItem
              key={frame.id}
              frame={frame}
              index={index}
              onDelete={onDelete}
              onRotate={onRotate}
              onFlip={onFlip}
              onCleanSelection={onCleanSelection}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
