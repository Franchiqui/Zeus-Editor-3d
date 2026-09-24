'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type ChatMessage = {
  id: string; role: 'user' | 'assistant'; content: string 
};

const STORAGE_KEY = 'zeus_chat_persisted';

function loadPersisted(): { conversationId: string | null; messages: ChatMessage[] } {
  if (typeof window === 'undefined') return { conversationId: null, messages: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversationId: null, messages: [] };
    const data = JSON.parse(raw);
    const id = typeof data?.conversationId === 'string' ? data.conversationId : null;
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    if (!msgs.every((m: unknown) => m && typeof m === 'object' && 'role' in m && 'content' in m)) {
      return { conversationId: id, messages: [] };
    }
    return { conversationId: id, messages: msgs as ChatMessage[] };
  } catch {
    return { conversationId: null, messages: [] };
  }
}

function savePersisted(conversationId: string | null, messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  if (conversationId === null && messages.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId, messages }));
  } catch {
    // ignore quota or parse errors
  }
}

type ChatContextValue = {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  startNewChat: () => void;
  loadConversation: (id: string) => Promise<void>;
  refreshConversations: number;
  triggerRefreshConversations: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversationId, setConversationId] = useState<string | null>(() => loadPersisted().conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted().messages);
  const [refreshConversations, setRefreshConversations] = useState(0);

  useEffect(() => {
    savePersisted(conversationId, messages);
  }, [conversationId, messages]);

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: ChatMessage[] = (data.messages || []).map((m: { role: string; text: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.text ?? '',
      }));
      setConversationId(id);
      setMessages(msgs);
    } catch {
      setConversationId(id);
      setMessages([]);
    }
  }, []);

  const triggerRefreshConversations = useCallback(() => {
    setRefreshConversations((n) => n + 1);
  }, []);

  const value: ChatContextValue = {
    conversationId,
    setConversationId,
    messages,
    setMessages,
    startNewChat,
    loadConversation,
    refreshConversations,
    triggerRefreshConversations,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}
