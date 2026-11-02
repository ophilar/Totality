#!/usr/bin/env python3
"""Transplant Timelines onto 0.4.4 without importing optimization or the 0.6 UI."""
from pathlib import Path
import subprocess as sp
import json
import re

SOURCE='60e06fa80575cccc4f002b5b8d2ccc221b65c0c3'
BASE='d6aea604e5c1f870150772c57cd0c9fc2073e69c'
def run(*cmd): sp.run(cmd,check=True)
def edit(p,a,b,n=1):
    f=Path(p);t=f.read_text();k=t.count(a)
    if k!=n: raise RuntimeError(f'{p}: expected {n} matches for {a!r}, got {k}')
    f.write_text(t.replace(a,b))
def after(p,a,b): edit(p,a,a+b)
def before(p,a,b): edit(p,a,b+a)
def remove_lines(p,predicate,count):
    f=Path(p); lines=f.read_text().splitlines(True)
    found=[x for x in lines if predicate(x)]
    if len(found)!=count:raise RuntimeError(f'{p}: expected {count} line removals, got {len(found)}')
    f.write_text(''.join(x for x in lines if not predicate(x)))
assert sp.check_output(['git','rev-parse','HEAD'],text=True).strip()==BASE
scopes=['data/timelines','src/main/services/timelines','src/main/ipc/timelines.ts',
'src/renderer/src/components/timelines','tests/fixtures/timeline-ipc','tests/fixtures/timelines',
'tests/unit/services/timelines','tests/unit/TimelinesViewRendering.test.tsx',
'tests/unit/components/TimelinesViewLayout.test.tsx','tests/unit/ipcChannelMap.test.ts']
run('git','restore','--source='+SOURCE,'--staged','--worktree','--',*scopes)
channels={'timelinesGetPlexPlaylists':'timelines:getPlexPlaylists','timelinesGetRecipe':'timelines:getRecipe',
'timelinesListParserPlugins':'timelines:listParserPlugins','timelinesListRecipes':'timelines:listRecipes',
'timelinesRemoveParserPlugin':'timelines:removeParserPlugin','timelinesResolveTimeline':'timelines:resolveTimeline',
'timelinesSaveParserPlugin':'timelines:saveParserPlugin','timelinesSyncPlexPlaylist':'timelines:syncPlexPlaylist',
'timelinesCancel':'timelines:cancel','operationsUpdated':'operations:updated'}
Path('src/shared/timelineChannels.ts').write_text('export const TIMELINE_CHANNELS = '+json.dumps(channels,indent=2)+' as const\n')
ipc='src/main/ipc/timelines.ts'
edit(ipc,"import { IPC_CHANNELS } from '../../shared/ipcChannels'","import { TIMELINE_CHANNELS } from '../../shared/timelineChannels'")
f=Path(ipc); t=f.read_text();assert t.count('IPC_CHANNELS.timelines')==8
f.write_text(t.replace('IPC_CHANNELS.timelines','TIMELINE_CHANNELS.timelines'))
after(ipc,'export function registerTimelinesHandlers(timelineProvider: ITimelineRecipeProvider = provider): void {\n',
"  createValidatedIpcHandlerWithEvent(TIMELINE_CHANNELS.timelinesCancel, z.string().min(1).max(100), async (event, requestId) => operationRequestRegistry.cancel(event.sender.id, requestId))\n")
# Reuse the existing fully implemented cancellable operation registry, limited
# to timeline-specific operation kinds.
run('git','restore','--source='+SOURCE,'--staged','--worktree','--','src/main/ipc/utils/OperationRequestRegistry.ts')
reg='src/main/ipc/utils/OperationRequestRegistry.ts'
edit(reg,"import { IPC_CHANNELS } from '../../../shared/ipcChannels'","import { TIMELINE_CHANNELS } from '../../../shared/timelineChannels'")
f=Path(reg);s=f.read_text();assert 'IPC_CHANNELS.operationsUpdated' in s
s=s.replace('IPC_CHANNELS.operationsUpdated','TIMELINE_CHANNELS.operationsUpdated')
s=s.replace("'duplicate-scan' | 'ai-report' | 'timeline' | 'plex-playlist' | 'update-download' | 'sonarr-wait' | 'optimization-preflight'","'timeline' | 'plex-playlist'")
a=s.index('  setPaused(');b=s.index('  getSnapshot(',a);s=s[:a]+s[b:];f.write_text(s)
# Add the two typed Zod handler forms needed by timeline IPC.
handlers='src/main/ipc/utils/createHandler.ts'
after(handlers,"import { getErrorMessage, isNodeError } from '../../services/utils/errorUtils'\n",
"import { z } from 'zod'\nimport { validateInput } from '../../validation/schemas'\n")
with Path(handlers).open('a') as f:
    f.write("""
export function createValidatedIpcHandler<TSchema extends z.ZodType, TReturn>(
  channel: string, schema: TSchema, handler: (...args: any[]) => Promise<TReturn>
): void {
  createIpcHandler(channel, async (...args: unknown[]) => {
    const value = validateInput(schema, schema instanceof z.ZodTuple ? args : args[0], channel)
    return handler(...(schema instanceof z.ZodTuple ? value as unknown[] : [value]))
  })
}
export function createValidatedIpcHandlerWithEvent<TSchema extends z.ZodType, TReturn>(
  channel: string, schema: TSchema,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<TReturn>
): void {
  createIpcHandlerWithEvent(channel, async (event, ...args: unknown[]) => {
    const value = validateInput(schema, schema instanceof z.ZodTuple ? args : args[0], channel)
    return handler(event, ...(schema instanceof z.ZodTuple ? value as unknown[] : [value]))
  })
}
""")
# HTTP: preserve upstream AbortSignal and check non-JSON Plex write endpoints.
run('git','restore','--source='+SOURCE,'--staged','--worktree','--','src/main/services/utils/httpClient.ts')
engine='src/main/services/timelines/TimelineResolutionEngine.ts'
edit(engine,'duration: match.duration_ms,','duration: match.duration,')
edit(engine,'row.series_identity_key',"(row.series_tmdb_id || normalizeMediaTitle(row.series_title || ''))",9)
edit(engine,'episodes[0].series_identity_key',"(episodes[0].series_tmdb_id || normalizeMediaTitle(episodes[0].series_title || ''))")
# The v0.4.4 schema has no per-series TVDB/IMDb key; never claim that it does.
edit(engine,"row.series_identity_key === "+chr(96)+"tvdb:","(row.series_tmdb_id || '') === "+chr(96)+"tvdb:",1) if False else None
# Replace unavailable identifier checks with explicit failure, rather than
# risking a title match for a canonical-but-unrepresented identity.
p=Path(engine);s=p.read_text()
s=re.sub(r"canonical.push\(\(row.series_tmdb_id \|\| normalizeMediaTitle\(row.series_title \|\| ''\)\) === "+re.escape(chr(96))+"tvdb:[^\\n]+", "canonical.push(false)", s)
s=re.sub(r"canonical.push\(\(row.series_tmdb_id \|\| normalizeMediaTitle\(row.series_title \|\| ''\)\) === "+re.escape(chr(96))+"imdb:[^\\n]+", "canonical.push(false)", s)
s=re.sub(r"if \(ids\.tvdbId && \(row\.series_tmdb_id \|\| normalizeMediaTitle\(row\.series_title \|\| ''\)\)\?\.startsWith\('tvdb:'\)[^\\n]+", "",s)
s=re.sub(r"if \(ids\.imdbId && item\.type !== 'movie' && \(row\.series_tmdb_id \|\| normalizeMediaTitle\(row\.series_title \|\| ''\)\)\?\.startsWith\('imdb:'\)[^\\n]+", "",s)
p.write_text(s)
# Add startup handlers and channel transport without copying the 0.6 IPC refactor.
after('src/main/index.ts',"import { registerTaskQueueHandlers } from './ipc/taskQueue'\n",
"import { registerTimelinesHandlers } from './ipc/timelines'\n")
after('src/main/index.ts','    registerTaskQueueHandlers()\n','    registerTimelinesHandlers()\n')
mapfile='src/shared/ipcChannelMap.ts'
before(mapfile,'export const RPC_CHANNEL_MAP: Record<string, string> = {',
"import { TIMELINE_CHANNELS } from './timelineChannels'\n\n")
after(mapfile,'export const RPC_CHANNEL_MAP: Record<string, string> = {\n',
"  ...Object.fromEntries(Object.entries(TIMELINE_CHANNELS).filter(([key]) => key.startsWith('timelines'))),\n")
edit('tests/unit/ipcChannelMap.test.ts',"import { IPC_CHANNELS } from '../../src/shared/ipcChannels'","import { TIMELINE_CHANNELS } from '../../src/shared/timelineChannels'")
p=Path('tests/unit/ipcChannelMap.test.ts');s=p.read_text();assert s.count('IPC_CHANNELS.timelines')==8;p.write_text(s.replace('IPC_CHANNELS.timelines','TIMELINE_CHANNELS.timelines'))
pre='src/preload/index.ts'
after(pre,"import type { ConnectionTestResult } from '@main/types/ipc'\n",
"""import { TIMELINE_CHANNELS } from '../shared/timelineChannels'
import type { TimelineRecipeSummary, TimelineFetchOptions, TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import type { TimelineResolutionOperationResult } from '@main/services/timelines/TimelineResolutionEngine'
import type { TimelineParserPlugin, TimelineParserPluginInput } from '@main/services/timelines/TimelineParserPlugin'
import type { PlexPlaylistSummary, PlexPlaylistSyncResult } from '@main/services/timelines/PlexPlaylistSyncService'
""")
old=sp.check_output(['git','show',SOURCE+':src/preload/index.ts'],text=True)
a=old.index('  timelinesListRecipes: () => ipcRenderer.invoke(')
b=old.index('  transcodingGetCapabilities:',a)
methods=old[a:b].replace('IPC_CHANNELS.timelines','TIMELINE_CHANNELS.timelines')
methods+="  timelinesCancel: (requestId: string) => ipcRenderer.invoke(TIMELINE_CHANNELS.timelinesCancel, requestId),\n"
after(pre,"contextBridge.exposeInMainWorld('electronAPI', {\n",methods)
a=old.index('  timelinesListRecipes: () => Promise<')
b=old.index('  transcodingGetCapabilities:',a)
typeMethods=old[a:b].replace('  timelinesCancel: (requestId: string) => Promise<void>',
"  timelinesCancel: (requestId: string) => Promise<'cancelling' | 'committing' | 'missing'>")
after(pre,"export interface ElectronAPI {\n",typeMethods)
edit('src/renderer/src/components/timelines/TimelinesView.tsx',
'window.electronAPI.dbCancelOperation(requestId)','window.electronAPI.timelinesCancel(requestId)')
p=Path('src/renderer/src/components/timelines/TimelinesView.tsx');s=p.read_text()
s=re.sub(r'<button type="button" onClick=\{\(\) => window.dispatchEvent\(new Event\('+"'operations:openActivity'"+r'\)\)\} className="text-primary hover:underline">Manage in Activity</button>', '',s)
p.write_text(s)
# Add Timeline navigation to 0.4.4 without importing the v0.6 redesign.
app='src/renderer/src/App.tsx'
edit(app,"import { useState, useEffect, useRef, useCallback, useMemo } from 'react'",
"import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'")
after(app,"import { SectionErrorBoundary } from './components/ui/SectionErrorBoundary'\n",
"const TimelinesView = lazy(() => import('./components/timelines/TimelinesView').then(module => ({ default: module.TimelinesView })))\n")
edit(app,"type AppView = 'dashboard' | 'library'","type AppView = 'dashboard' | 'library' | 'timelines'")
before(app,"  const handleBack = useCallback(","""  const handleNavigateToTimelines = () => {
    if (!isRestoringRef.current) pushNavState({ view: 'timelines' })
    setCurrentView('timelines')
  }

""")
edit('src/renderer/src/contexts/NavigationContext.tsx',
"view: 'dashboard' | 'library'","view: 'dashboard' | 'library' | 'timelines'")
after(app,'          onNavigateHome={handleNavigateToDashboard}\n',
'          onNavigateTimelines={handleNavigateToTimelines}\n')
edit(app,"        {currentView === 'dashboard' && !isMobile ? (",
"""        <Suspense fallback={<main className="fixed inset-x-0 bottom-0 top-[76px]" aria-busy="true" />}>
        {currentView === 'timelines' ? (
          <main className="fixed top-[76px] bottom-0 transition-[left,right] duration-300 ease-out" style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}>
            <SectionErrorBoundary section="Timelines"><TimelinesView /></SectionErrorBoundary>
          </main>
        ) : currentView === 'dashboard' && !isMobile ? (""")
before(app,'        {showAddSourceModal && (','        </Suspense>\n')
p=Path(app);s=p.read_text()
# Chat supports dashboard/library only, not the extra timeline route.
s=s.replace("currentView: currentView,", "currentView: currentView === 'timelines' ? 'dashboard' : currentView,")
p.write_text(s)
top='src/renderer/src/components/layout/TopBar.tsx'
edit(top,'Home, Film,','Home, ListOrdered, Film,')
edit(top,"currentView: 'dashboard' | 'library'","currentView: 'dashboard' | 'library' | 'timelines'")
after(top,'  onNavigateHome: () => void\n','  onNavigateTimelines: () => void\n')
after(top,'  onNavigateHome,\n','  onNavigateTimelines,\n')
button="""              <button onClick={onNavigateTimelines}
                className={TEMPLATE}
                role="tab" aria-selected={currentView === 'timelines'} aria-label="Timelines">
                <ListOrdered className="w-4 h-4" /><span>Timelines</span>
              </button>
""".replace('TEMPLATE',chr(96)+"px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 "+chr(36)+"{currentView === 'timelines' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}"+chr(96))
before(top,'              {/* Divider - only show if any library buttons will render */}',button+'\n')
after('electron-builder.yml','  - dist-electron\n','  - data/timelines/midnight-diner-release-order.json\n')
with Path('.gitignore').open('a') as f:
    f.write('\n# User timeline recipes\ndata/timelines/*.json\n!data/timelines/midnight-diner-release-order.json\n')
for name in ['package.json','package-lock.json']:
    p=Path(name);j=json.loads(p.read_text());j['version']='0.5.0'
    if name.endswith('lock.json'):j['packages']['']['version']='0.5.0'
    if name=='package.json':
        oldp=json.loads(sp.check_output(['git','show',SOURCE+':package.json'],text=True))
        for key in ['css-select','domhandler','domutils','htmlparser2']:
            j['dependencies'][key]=oldp['dependencies'][key]
    p.write_text(json.dumps(j,indent=2,ensure_ascii=False)+'\n')
for path in ['src/main/services/timelines/TraktRecipeProvider.ts','src/renderer/src/components/timelines/TimelinesView.tsx']:
    p=Path(path);p.write_text('\n'.join(line.rstrip() for line in p.read_text().splitlines())+'\n')
print("v0.5 Timelines source assembly complete")
