'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import React, { useState, useSyncExternalStore } from 'react'

import type { Theme } from './types'

import { useTheme } from '..'
import { themeLocalStorageKey } from './types'

const subscribeToStoredTheme = (onStoreChange: () => void) => {
  window.addEventListener('storage', onStoreChange)
  return () => window.removeEventListener('storage', onStoreChange)
}

const getStoredTheme = () => window.localStorage.getItem(themeLocalStorageKey) ?? 'auto'

/* Empty on the server so hydration renders the placeholder, matching the previous
 * behaviour where the stored preference was only read after mount. */
const getServerTheme = () => ''

export const ThemeSelector: React.FC = () => {
  const { setTheme } = useTheme()
  const storedTheme = useSyncExternalStore(subscribeToStoredTheme, getStoredTheme, getServerTheme)
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const value = selectedTheme ?? storedTheme

  const onThemeChange = (themeToSet: Theme & 'auto') => {
    if (themeToSet === 'auto') {
      setTheme(null)
    } else {
      setTheme(themeToSet)
    }
    setSelectedTheme(themeToSet)
  }

  return (
    <Select onValueChange={onThemeChange} value={value}>
      <SelectTrigger
        aria-label="Select a theme"
        className="w-auto bg-transparent gap-2 pl-0 md:pl-3 border-none"
      >
        <SelectValue placeholder="Theme" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  )
}
