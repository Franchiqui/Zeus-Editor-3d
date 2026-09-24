'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n';

export interface GoogleFont {
  family: string
  category?: string
  variants?: string[]
}

export interface GoogleFontsModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectFont: (family: string) => void
}

const FALLBACK_FONTS: GoogleFont[] = [
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Oswald', category: 'sans-serif' },
  { family: 'Roboto Slab', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Ubuntu', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Bebas Neue', category: 'sans-serif' },
  { family: 'Anton', category: 'sans-serif' },
  { family: 'Shadows Into Light', category: 'handwriting' },
  { family: 'Dancing Script', category: 'handwriting' },
  { family: 'Pacifico', category: 'handwriting' },
  { family: 'Press Start 2P', category: 'display' },
  { family: 'Bangers', category: 'display' },
]

function GoogleFontsModal({ isOpen, onClose, onSelectFont }: GoogleFontsModalProps) {
  const { t } = useI18n();
  const [fonts, setFonts] = useState<GoogleFont[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadedFamilies, setLoadedFamilies] = useState<Set<string>>(new Set())

  const loadFonts = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = query
        ? `https://fonts.google.com/metadata/fonts?search=${encodeURIComponent(query)}`
        : 'https://fonts.google.com/metadata/fonts'
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Error ${response.status}`)
      const data = await response.json()
      const items = data?.familyMetadataList || []
      const mapped: GoogleFont[] = items.map((item: any) => ({
        family: item.family,
        category: item.category,
        variants: Object.keys(item.fonts || {}),
      }))
      setFonts(mapped)
    } catch (e) {
      console.error('Error cargando fuentes:', e)
      setError(t('app.errLoadFonts'))
      setFonts(FALLBACK_FONTS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && fonts.length === 0) {
      loadFonts('')
    }
  }, [isOpen, fonts.length, loadFonts])

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setError(null)
    }
  }, [isOpen])

  const handleSearch = () => {
    loadFonts(search)
  }

  const handleSelect = (family: string) => {
    const familyName = family.replace(/['"]/g, '')
    const fontName = familyName.replace(/ /g, '+')
    if (!loadedFamilies.has(familyName)) {
      const linkId = `google-font-${familyName.replace(/[^a-zA-Z0-9]/g, '-')}`
      const existing = document.getElementById(linkId)
      if (!existing) {
        const link = document.createElement('link')
        link.id = linkId
        link.href = `https://fonts.googleapis.com/css2?family=${fontName}:wght@400;700&display=swap`
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      setLoadedFamilies((prev) => new Set(prev).add(familyName))
    }
    onSelectFont(familyName)
    onClose()
  }

  const filteredFonts = fonts.filter((font) =>
    font.family.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">{t('googleFonts.title')}</h2>
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch()
              }
            }}
            placeholder={t('googleFonts.searchPlaceholder')}
            className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            {t('googleFonts.search')}
          </button>
        </div>
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('googleFonts.loading')}
            </div>
          )}
          {!loading && filteredFonts.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-400">
              {t('googleFonts.none')}
            </div>
          )}
          {filteredFonts.map((font) => (
            <button
              key={font.family}
              onClick={() => handleSelect(font.family)}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-4 py-3 text-left transition hover:border-blue-500"
            >
              <div
                className="text-base font-medium"
                style={{ fontFamily: `'${font.family.replace(/'/g, '')}', Arial` }}
              >
                {font.family}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {font.category}
                {font.variants && font.variants.length > 0 && t('googleFonts.variants', { n: font.variants.length })}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

