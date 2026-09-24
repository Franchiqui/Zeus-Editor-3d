'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { History, ChevronUp, Plus, Trash2, GripHorizontal, Pencil, Check } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useChatContext } from '@/components/ChatContext';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

type ConversationItem = { id: string; title?: string; created?: string };

const HISTORY_POSITION_KEY = 'zeus_chat_history_positions_v5';
const DEFAULT_LEFT = 24;
const DEFAULT_BOTTOM = 100;
const MAX_VISIBLE_ROWS = 5;
const ROW_HEIGHT_REM = 2.75;

type PagePositions = Record<string, { left: number; bottom: number }>;

function loadAllPositions(): PagePositions {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HISTORY_POSITION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function ChatHistoryPanel() {

  const { t } = useI18n();  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: DEFAULT_LEFT, bottom: DEFAULT_BOTTOM });
  const dragControls = useDragControls();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const { conversationId, startNewChat, loadConversation, refreshConversations, triggerRefreshConversations } = useChatContext();

  // Cargar posición específica de esta página
  useEffect(() => {
    const allPos = loadAllPositions();
    const pagePos = allPos[pathname] || { left: DEFAULT_LEFT, bottom: DEFAULT_BOTTOM };
    setPosition(pagePos);
  }, [pathname]);

  const saveCurrentPosition = (newPos: { left: number; bottom: number }) => {
    setPosition(newPos);
    try {
      const allPos = loadAllPositions();
      allPos[pathname] = newPos;
      localStorage.setItem(HISTORY_POSITION_KEY, JSON.stringify(allPos));
    } catch (e) {
      console.error("Error saving chat position", e);
    }
  };

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat');
      if (!res.ok) return;
      const data = await res.json();
      const items: ConversationItem[] = (data.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.title || `Conversación ${c.id.slice(0, 8)}`,
        created: c.created,
      }));
      setConversations(items);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [refreshConversations]);

  const handleNewChat = () => {
    startNewChat();
    setExpanded(false);
  };

  const handleSelect = async (id: string) => {
    await loadConversation(id);
    setExpanded(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t('app.deleteConversationConfirm'))) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        if (conversationId === id) startNewChat();
        triggerRefreshConversations();
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, c: ConversationItem) => {
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
        setConversations((prev) =>
          prev.map((c) => (c.id === editingId ? { ...c, title: newTitle } : c))
        );
        triggerRefreshConversations();
      }
    } finally {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  const formatDate = (created?: string) => {
    if (!created) return '';
    const d = new Date(created);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };

  const isHiddenPage = pathname === '/auth' || pathname === '/terms' || pathname === '/privacy';
  if (isHiddenPage) return null;

  return (
    <motion.div
      ref={panelRef}
      className="fixed z-[100] flex flex-col items-stretch cursor-default shadow-2xl"
      style={{ left: position.left, bottom: position.bottom }}
      drag
      dragMomentum={false}
      dragElastic={0}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={() => {
        if (panelRef.current) {
          const rect = panelRef.current.getBoundingClientRect();
          saveCurrentPosition({
            left: rect.left,
            bottom: window.innerHeight - rect.bottom
          });
        }
      }}
    >
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden rounded-t-xl border border-b-0 border-gray-700 bg-gray-900 shadow-xl"
            style={{ maxHeight: 'min(50vh, 320px)', minWidth: 280 }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/80">
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-green-400" />
                Historial
              </span>
              <button
                type="button"
                onClick={handleNewChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors shadow-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('app.newChat')}
              </button>
            </div>
            <div
              className="overflow-y-auto p-2 overscroll-contain scrollbar-history"
              style={{ maxHeight: `${MAX_VISIBLE_ROWS * ROW_HEIGHT_REM}rem` }}
            >
              {loading ? (
                <p className="text-gray-500 text-sm py-4 text-center">Cargando...</p>
              ) : conversations.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">Sin conversaciones</p>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      {editingId === c.id ? (
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-600"
                          onClick={(e) => e.stopPropagation()}
                        >
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
                          <button onClick={handleSaveEdit} className="text-green-400 p-1"><Check className="w-4 h-4"/></button>
                        </div>
                      ) : (
                        <div
                          role="button"
                          onClick={() => handleSelect(c.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                            conversationId === c.id ? 'bg-green-600/30 text-green-200' : 'hover:bg-gray-700 text-gray-200'
                          }`}
                        >
                          <span className="truncate flex-1 min-w-0">{c.title}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleStartEdit(e, c)}
                              className="p-1 text-gray-200 hover:text-amber-400"
                              title={t('app.editName')}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(e, c.id)}
                              className="p-1 text-gray-200 hover:text-red-400"
                              title={t('app.deleteConversation')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex items-center justify-center gap-2 py-1.5 px-2 bg-gray-800/95 border border-gray-700 cursor-grab active:cursor-grabbing touch-none select-none",
          !expanded && "rounded-t-xl"
        )}
        onPointerDown={(e) => dragControls.start(e)}
        title="Arrastra para mover"
      >
        <GripHorizontal className="w-5 h-5 text-emerald-500 opacity-50" />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-b-xl bg-gray-800 border border-gray-700 border-t-0 hover:bg-gray-700 text-gray-200 shadow-lg transition-colors group"
      >
        <History className={`w-4 h-4 transition-colors ${expanded ? 'text-green-400' : 'text-gray-500 group-hover:text-green-400'}`} />
        <span className="text-xs font-bold uppercase tracking-wider">{t('app.history')}</span>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronUp className="w-4 h-4 text-gray-500" />
        </motion.div>
      </button>
    </motion.div>
  );
}
