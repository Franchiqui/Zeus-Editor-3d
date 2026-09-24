'use client';

import React, { memo, useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Bars3Icon,
  XMarkIcon,
  UserCircleIcon,
  BellIcon,
  MagnifyingGlassIcon,
  Cog6ToothIcon,
  FolderIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface HeaderProps {
  user?: {
    name: string;
    email: string;
    avatar?: string;
    storageUsed: number;
    storageTotal: number;
  };
  onSearch?: (query: string) => void;
  onNotificationClick?: () => void;
  onSettingsClick?: () => void;
  onUploadClick?: () => void;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  current: boolean;
}

const mediaTypes = [
  { id: 'all', label: 'All', icon: FolderIcon },
  { id: 'images', label: 'Images', icon: PhotoIcon },
  { id: 'videos', label: 'Videos', icon: FilmIcon },
  { id: 'audio', label: 'Audio', icon: MusicalNoteIcon },
];

const Header: React.FC<HeaderProps> = memo(({
  user,
  onSearch,
  onNotificationClick,
  onSettingsClick,
  onUploadClick,
}) => {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeMediaType, setActiveMediaType] = useState<string | null>(null);

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: SparklesIcon, current: pathname === '/dashboard' },
    { name: 'Explore', href: '/explore', icon: FolderIcon, current: pathname === '/explore' },
    { name: 'Projects', href: '/projects', icon: FilmIcon, current: pathname === '/projects' },
    { name: 'Studio', href: '/studio', icon: MusicalNoteIcon, current: pathname === '/studio' },
    { name: 'Library', href: '/library', icon: PhotoIcon, current: pathname === '/library' },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  }, [searchQuery, onSearch]);

  const handleMediaTypeClick = useCallback((typeId: string) => {
    setActiveMediaType(typeId);
  }, []);

  const storagePercentage = user ? (user.storageUsed / user.storageTotal) * 100 : 0;

  return (
    <header className={cn(
      "sticky top-0 z-50 w-full transition-all duration-300",
      isScrolled 
        ? "bg-gray-900/95 backdrop-blur-md border-b border-gray-800/50 shadow-lg"
        : "bg-gradient-to-b from-gray-900 to-gray-900/95"
    )}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <button
              type="button"
              className="lg:hidden mr-3 p-2 rounded-lg hover:bg-gray-800"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6 text-gray-300" />
              ) : (
                <Bars3Icon className="h-6 w-6 text-gray-300" />
              )}
            </button>

            <Link href="/" className="flex items-center space-x-3">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 bg-gradient-to-br from-green-600 to-yellow-500 rounded-xl transform rotate-12" />
                <div className="absolute inset-1 bg-gray-900 rounded-lg flex items-center justify-center">
                  <SparklesIcon className="h-6 w-6 text-green-400" />
                </div>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
                  Zeus Media Studio IA
                </h1>
                <p className="text-xs text-gray-400">Create, organize, share your multimedia universe</p>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  item.current
                    ? "bg-gray-800 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-800/50"
                )}
                aria-current={item.current ? 'page' : undefined}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.name}
              </Link>
            ))}
          </nav>

          {/* Search and Actions */}
          <div className="flex items-center space-x-4">
            {/* Media Type Filter */}
            <div className="hidden md:flex items-center space-x-1 bg-gray-800/50 rounded-lg p-1">
              {mediaTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => handleMediaTypeClick(type.id)}
                  className={cn(
                    "flex items-center px-3 py-1.5 rounded-md text-sm transition-all",
                    activeMediaType === type.id
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-700/50"
                  )}
                >
                  <type.icon className="mr-1.5 h-4 w-4" />
                  {type.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="hidden lg:block relative">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search media, projects..."
                  className="pl-10 pr-4 py-2 w-64 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                  aria-label="Search"
                />
              </div>
            </form>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onUploadClick}
                className="px-4 py-2 bg-gradient-to-r from-green-600 to-yellow-500 text-white text-sm font-medium rounded-lg hover:from-green-700 hover:to-yellow-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all"
              >
                Upload
              </button>

              <button
                type="button"
                onClick={onNotificationClick}
                className="relative p-2 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                aria-label="Notifications"
              >
                <BellIcon className="h-6 w-6 text-gray-300" />
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />
              </button>

              <button
                type="button"
                onClick={onSettingsClick}
                className="p-2 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                aria-label="Settings"
              >
                <Cog6ToothIcon className="h-6 w-6 text-gray-300" />
              </button>

              {/* User Profile */}
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                  aria-label="User menu"
                >
                  {user?.avatar ? (
                    <div className="relative h-8 w-8 rounded-full overflow-hidden">
                      <Image
                        src={user.avatar}
                        alt={user.name}
                        fill
                        className="object-cover"
                        sizes="32px"
                      />
                    </div>
                  ) : (
                    <UserCircleIcon className="h-8 w-8 text-gray-300" />
                  )}
                  <div className="hidden lg:block text-left">
                    <p className="text-sm font-medium text-white">{user?.name}</p>
                    <p className="text-xs text-gray-400">
                      {Math.round(storagePercentage)}% storage used
                    </p>
                  </div>
                </button>

                {/* Storage Indicator Tooltip */}
                <div className="absolute right-0 top-full mt-2 hidden group-hover:block">
                  <div className="w-48 p-3 bg-gray-800 rounded-lg shadow-xl border border-gray-700">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300">Storage</span>
                      <span className="text-white font-medium">
                        {(user?.storageUsed || 0).toFixed(1)} GB / {(user?.storageTotal || 0).toFixed(1)} GB
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${storagePercentage}%` }}
                        transition={{ duration: 0.5 }}
                        className="h-full rounded-full bg-gradient-to-r from-green-500 to-yellow-400"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Search */}
        <div className="lg:hidden pb-3">
          <form onSubmit={handleSearch} className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media, projects..."
              className="w-full pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              aria-label="Search"
            />
          </form>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden border-t border-gray-800 bg-gray-900"
          >
            <div className="px-4 py-3 space-y-1">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center px-3 py-3 rounded-lg text-base font-medium",
                    item.current
                      ? "bg-gray-800 text-white"
                      : "text-gray-300 hover:text-white hover:bg-gray-800/50"
                  )}
                  aria-current={item.current ? 'page' : undefined}
                >
                  <item.icon className="mr-3 h-5 w-5" />
                  {item.name}
                </Link>
              ))}

              {/* Mobile Media Types */}
              <div className="pt-3 border-t border-gray-800">
                <div className="grid grid-cols-2 gap-2">
                  {mediaTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => {
                        handleMediaTypeClick(type.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "flex items-center justify-center px-3 py-2.5 rounded-lg text-sm",
                        activeMediaType === type.id
                          ? "bg-gray-700 text-white"
                          : "text-gray-400 bg-gray-800/50 hover:text-white"
                      )}
                    >
                      <type.icon className="mr-2 h-4 w-4" />
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
});

Header.displayName='Header';

export default Header;