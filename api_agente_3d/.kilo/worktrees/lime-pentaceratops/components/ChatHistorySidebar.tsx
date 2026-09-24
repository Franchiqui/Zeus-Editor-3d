'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useChatContext } from '@/components/ChatContext';
import { X, Trash2, Plus, Pencil, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type ConversationRow = {
  id: string;
  title?: string;
  created?: string;
};

export function ChatHistorySidebar({ open, onClose, showBackdrop = true }: { open: boolean; onClose: () => void; showBackdrop?: boolean }) {

  const { t } = useI18n();  const { conversationId, setConversationId, setMessages, triggerRefreshConversations } = useChatContext();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const loadConversations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat');
      if (!res.ok) return;
      const data = await res.json();
      const items = (data.conversations || []) as ConversationRow[];
      setConversations(items);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadConversations();
  }, [open]);

  const handleSelect = async (id: string) => {
    setConversationId(id);
    const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = await res.json();
    const msgs = (data.messages || []).map((m: { role: string; text?: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text || '',
    }));
    setMessages(msgs);
    onClose();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }
    triggerRefreshConversations();
    loadConversations();
  };

  const handleNewChat = () => {
    onClose();
    setConversationId(null);
    setMessages([]);
  };

  const handleStartEdit = (e: React.MouseEvent, c: ConversationRow) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditingTitle(c.title || '');
  };

  const handleSaveEdit = async () => {
    if (editingId == null) return;
    const newTitle = editingTitle.trim() || t('app.untitled');
    try {
      const res = await fetch('/api/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: editingId, title: newTitle }),
      });
      if (res.ok) {
        setConversations((prev) => prev.map((c) => c.id === editingId ? { ...c, title: newTitle } : c));
        triggerRefreshConversations();
      }
    } finally {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  return (
    <>
      {showBackdrop && open && (
        <div
          className="fixed inset-0 z-[125] bg-black/40"
          onClick={onClose}
        />
      )}
      <div
        ref={panelRef}
        className={`fixed left-0 top-12 bottom-0 z-[130] w-80 bg-gray-900 border-r border-gray-700 shadow-2xl transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/80">
          <span className="font-semibold text-white text-sm uppercase tracking-widest">{t('app.history')}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors"
              title="{t('app.newConversation')}"
            >
              <Plus className="w-4 h-4" />
              {t('app.newChat')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              aria-label="Cerrar historial"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-3 space-y-1 overflow-y-auto h-full chat-scrollbar">
          {loading && <p className="text-xs text-gray-500 text-center py-4">Cargando...</p>}
          {!loading && conversations.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">No hay conversaciones guardadas.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${conversationId === c.id ? 'bg-blue-600/20 text-blue-300' : 'hover:bg-gray-800 text-gray-200'}`}
              onClick={() => editingId !== c.id && handleSelect(c.id)}
            >
              <div className="flex-1 min-w-0">
                {editingId === c.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded text-white outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="p-1 rounded text-green-400 hover:bg-gray-700"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm truncate">{c.title || t('app.untitledConversation')}</p>
                    {c.created && (
                      <p className="text-[10px] text-gray-500 truncate">
                        {new Date(c.created).toLocaleString()}
                      </p>
                    )}
                  </>
                )}
              </div>
              {editingId !== c.id && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(e, c);
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-amber-400 hover:bg-gray-700 transition-colors"
                    title={t('app.editName')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id);
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
                    title={t('app.deleteConversation')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
