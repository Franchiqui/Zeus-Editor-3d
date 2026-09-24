'use client';

import React from 'react';
import { X, Plus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Tab } from '@/store/app-store';

interface TabsBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export const TabsBar = React.memo<TabsBarProps>(({ tabs, activeTabId, onSwitchTab, onCloseTab, onNewTab }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center bg-gray-900 border-b border-blue-500 h-9 px-2 gap-1 select-none">
      <div className="flex items-center gap-1 flex-1 overflow-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const title = tab.icon.title || t('editorIconos.actions.untitled');
          return (
            <div
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              className={[
                'group flex items-center gap-2 px-3 h-7 rounded-t cursor-pointer text-sm min-w-[80px] max-w-[200px] truncate transition-colors',
                isActive
                  ? 'bg-gray-800 text-white border-t-2 border-[#fe8825]'
                  : 'bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200',
              ].join(' ')}
              title={title}
            >
              <span className="truncate flex-1">{title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 transition-opacity"
                  title="Cerrar pestaña"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors shrink-0"
          title="Nueva pestaña"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

TabsBar.displayName = 'TabsBar';
