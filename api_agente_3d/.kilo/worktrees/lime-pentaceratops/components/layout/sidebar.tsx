'use client';

'use client';

import React, { memo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HomeIcon,
  FolderIcon,
  PencilIcon,
  Squares2X2Icon,
  SparklesIcon,
  TagIcon,
  ShareIcon,
  UserIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  DocumentIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
  FolderIcon as FolderIconSolid,
  PencilIcon as PencilIconSolid,
  Squares2X2Icon as Squares2X2IconSolid,
  SparklesIcon as SparklesIconSolid,
  TagIcon as TagIconSolid,
  ShareIcon as ShareIconSolid,
  UserIcon as UserIconSolid,
} from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface SidebarProps {
  className?: string;
}

interface NavItem {
  id: string;
  label?: string;
  labelKey?: string;
  icon: React.ComponentType<{ className?: string }>;
  activeIcon: React.ComponentType<{ className?: string }>;
  href: string;
  subItems?: {
    id: string;
    label?: string;
    labelKey?: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
  }[];
}

const navItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: HomeIcon,
    activeIcon: HomeIconSolid,
    href: '/dashboard',
  },
  {
    id: 'explorer',
    label: 'Explorador',
    icon: FolderIcon,
    activeIcon: FolderIconSolid,
    href: '/explorer',
    subItems: [
      { id: 'images', labelKey: 'app.sideImages', icon: PhotoIcon, href: '/explorer?type=image' },
      { id: 'videos', labelKey: 'app.sideVideos', icon: FilmIcon, href: '/explorer?type=video' },
      { id: 'audio', labelKey: 'app.sideAudio', icon: MusicalNoteIcon, href: '/explorer?type=audio' },
      { id: 'documents', labelKey: 'app.sideDocuments', icon: DocumentIcon, href: '/explorer?type=document' },
    ],
  },
  {
    id: 'editor',
    label: 'app.quickEditor',
    icon: PencilIcon,
    activeIcon: PencilIconSolid,
    href: '/editor',
  },
  {
    id: 'projects',
    label: 'Proyectos',
    icon: Squares2X2Icon,
    activeIcon: Squares2X2IconSolid,
    href: '/projects',
  },
];

const Sidebar = memo<SidebarProps>(({ className }) => {

  const { t } = useI18n();  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
    if (!collapsed) {
      setExpandedItems(new Set());
    }
  }, [collapsed]);
  
  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);
  
  const isActive = useCallback((href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }, [pathname]);
  
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setCollapsed(true);
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 280 }}
      className={cn(
        'relative flex flex-col h-screen bg-gradient-to-b from-gray-900 to-gray-950 border-r border-gray-800 overflow-hidden transition-all duration-300',
        className
      )}
      aria-label={t('app.mainNav')}
    >
      <div className="flex items-center justify-between p-6 border-b border-gray-800">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-600 to-yellow-500 flex items-center justify-center">
                <SparklesIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
                  Zeus Media Studio IA
                </h1>
                <p className="text-xs text-gray-400">Tu universo multimedia</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <button
          onClick={toggleCollapse}
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900"
          aria-label={collapsed ? 'Expandir sidebar' : 'Contraer sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRightIcon className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronLeftIcon className="w-5 h-5 text-gray-400" />
          )}
        </button>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-4 px-3" aria-label="{t('app.mainNav')}">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const expanded = expandedItems.has(item.id);
            const Icon = active ? item.activeIcon : item.icon;
            
            return (
              <li key={item.id}>
                <div className="space-y-1">
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      if (item.subItems && !collapsed) {
                        e.preventDefault();
                        toggleExpand(item.id);
                      }
                    }}
                    className={cn(
                      'flex items-center p-3 rounded-lg transition-all duration-200 group',
                      active
                        ? 'bg-gradient-to-r from-green-900/30 to-yellow-900/20 text-green-300 border-l-4 border-green-500'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <div className="relative">
                      <Icon className={cn('w-6 h-6 transition-colors', active && 'text-green-400')} />
                      {active && (
                        <motion.div
                          layoutId="activeIndicator"
                          className="absolute inset-0 rounded-full bg-green-500/20"
                          initial={false}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}
                    </div>
                    
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          className="flex items-center justify-between flex-1 ml-3"
                        >
                          <span className="font-medium">{item.labelKey ? t(item.labelKey) : (item.label?.startsWith('app.') ? t(item.label) : item.label)}</span>
                          {item.subItems && (
                            <motion.div
                              animate={{ rotate: expanded ? 90 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                            </motion.div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Link>
                  
                  {item.subItems && !collapsed && expanded && (
                    <motion.ul
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="ml-12 space-y-1 overflow-hidden"
                      aria-label={`Submenú de ${item.label}`}
                    >
                      {item.subItems.map((subItem) => (
                        <li key={subItem.id}>
                          <Link
                            href={subItem.href}
                            className={cn(
                              'flex items-center p-2 rounded-lg text-sm transition-colors',
                              isActive(subItem.href)
                                ? 'text-green-300'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
                            )}
                          >
                            <subItem.icon className="w-4 h-4 mr-3" />
                            {subItem.labelKey ? t(subItem.labelKey) : subItem.label}
                          </Link>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
      
      <div className="p-4 border-t border-gray-800">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 rounded-lg bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700/50"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-yellow-600 flex items-center justify-center">
                  <span className="font-bold text-white">U</span>
                </div>
                <div>
                  <p className="font-medium text-white">Usuario</p>
                  <p className="text-xs text-gray-400">Plan Pro</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Almacenamiento</span>
                  <span className="text-white">65%</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: '65%' }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-green-500 to-yellow-500"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      <style jsx global>{`
        .sidebar-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        
        .sidebar-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .sidebar-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(139, 92, 246, 0.3);
          border-radius: 20px;
        }
        
        .sidebar-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(139, 92, 246, 0.5);
        }
        
        @media (max-width: 768px) {
          aside {
            position: fixed !important;
            z-index: 40;
            box-shadow: rgba(0, 0, 0, 0.3) -10px 0px 25px -5px;
          }
        }
      `}</style>
    </motion.aside>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;