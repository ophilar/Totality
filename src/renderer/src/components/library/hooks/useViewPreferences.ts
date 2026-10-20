import { useState, useCallback, useRef } from 'react'
import { SETTING_KEYS } from '../../../../../shared/settingKeys'

import type { MediaViewType } from '../types'

interface UseViewPreferencesReturn {
  viewType: 'grid' | 'list'
  gridScale: number
  setViewType: (vt: 'grid' | 'list') => void
  setGridScale: (gs: number) => void
  viewPrefsLoadedRef: React.MutableRefObject<boolean>
  loadViewPrefs: (view: MediaViewType) => Promise<void>
}

/**
 * Hook to manage per-tab view type (grid/list) and grid scale preferences.
 * Persists preferences to settings automatically on change.
 *
 * @param view Current active media view tab
 */
export function useViewPreferences(view: MediaViewType, onError: (error: unknown) => void): UseViewPreferencesReturn {
  const [viewType, setViewTypeState] = useState<'grid' | 'list'>('grid')
  const [gridScale, setGridScaleState] = useState(4)
  const viewPrefsRef = useRef<Record<string, { viewType: 'grid' | 'list', gridScale: number }>>({})
  const viewPrefsLoadedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveViewPrefs = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void window.electronAPI.setSetting(SETTING_KEYS.library_view_prefs, JSON.stringify(viewPrefsRef.current)).catch(onError)
    }, 300)
  }, [onError])

  const setViewType = useCallback((vt: 'grid' | 'list') => {
    setViewTypeState(vt)
    if (!viewPrefsLoadedRef.current) return
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view] || { viewType: 'grid', gridScale: 4 }, viewType: vt }
    saveViewPrefs()
  }, [view, saveViewPrefs])

  const setGridScale = useCallback((gs: number) => {
    setGridScaleState(gs)
    if (!viewPrefsLoadedRef.current) return
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view] || { viewType: 'grid', gridScale: 4 }, gridScale: gs }
    saveViewPrefs()
  }, [view, saveViewPrefs])

  const loadViewPrefs = useCallback(async (currentView: MediaViewType) => {
    const saved = await window.electronAPI.getSetting(SETTING_KEYS.library_view_prefs)
    if (saved) {
      viewPrefsRef.current = JSON.parse(saved as string) as Record<string, { viewType: 'grid' | 'list', gridScale: number }>
    }
    viewPrefsLoadedRef.current = true
    const prefs = viewPrefsRef.current[currentView]
    if (prefs) {
      setViewTypeState(prefs.viewType)
      setGridScaleState(prefs.gridScale)
    }
  }, [])

  return { viewType, gridScale, setViewType, setGridScale, viewPrefsLoadedRef, loadViewPrefs }
}
