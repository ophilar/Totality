#!/usr/bin/env python3
"""One-time, assertion-driven extraction of Timelines from Totality's 0.5 tree."""
from pathlib import Path
import subprocess
import re

def tracked():
    return subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")[:-1]

def edit(name, old, new="", expected=1):
    path = Path(name)
    source = path.read_text()
    count = source.count(old)
    if count != expected:
        raise RuntimeError(f"{name}: expected {expected} occurrences of {old!r}, found {count}")
    path.write_text(source.replace(old, new))

def remove_matching_lines(name, predicate, expected):
    path = Path(name)
    lines = path.read_text().splitlines(keepends=True)
    candidates = [line for line in lines if predicate(line)]
    if len(candidates) != expected:
        raise RuntimeError(f"{name}: expected {expected} matching lines, found {len(candidates)}: {candidates}")
    path.write_text("".join(line for line in lines if not predicate(line)))

paths = tracked()
prefixes = (
    "data/timelines/", "src/main/services/timelines/",
    "src/renderer/src/components/timelines/",
    "tests/fixtures/timeline-ipc/", "tests/fixtures/timelines/",
    "tests/unit/services/timelines/",
)
standalone = {
    "src/main/ipc/timelines.ts",
    "tests/unit/TimelinesViewRendering.test.tsx",
    "tests/unit/components/TimelinesViewLayout.test.tsx",
    "tests/unit/ipcChannelMap.test.ts",
}
dedicated = [name for name in paths if name.startswith(prefixes) or name in standalone]
assert set(standalone) <= set(dedicated)
assert len(dedicated) >= 25, f"Unexpectedly small dedicated timeline set: {dedicated}"
for name in dedicated:
    Path(name).unlink()

remove_matching_lines(".gitignore", lambda s: "Local timeline data" in s or s.startswith("data/timelines/") or s.startswith("!data/timelines/"), 3)
remove_matching_lines("electron-builder.yml", lambda s: "data/timelines/midnight-diner-release-order.json" in s, 1)
remove_matching_lines("src/main/index.ts", lambda s: "import { registerTimelinesHandlers }" in s or "    registerTimelinesHandlers()" in s, 2)
edit("src/main/ipc/utils/OperationRequestRegistry.ts", "'timeline' | 'plex-playlist' | ", "")
remove_matching_lines("src/preload/index.ts", lambda s: s.startswith("import type ") and "/timelines/" in s, 5)
remove_matching_lines("src/preload/index.ts", lambda s: s.lstrip().startswith("timelines") and ("IPC_CHANNELS" in s or "=> Promise" in s), 17)
edit("src/preload/index.ts", "// Timelines & Transcoding", "// Transcoding")
edit("src/renderer/src/App.tsx", "const TimelinesView = lazy(() => import('./components/timelines/TimelinesView').then(module => ({ default: module.TimelinesView })))\n")
edit("src/renderer/src/App.tsx", "type AppView = 'dashboard' | 'library' | 'timelines'", "type AppView = 'dashboard' | 'library'")
edit("src/renderer/src/App.tsx", """  const handleNavigateToTimelines = () => {
    if (!isRestoringRef.current) pushNavState({ view: 'timelines' })
    setCurrentView('timelines')
  }

""")
edit("src/renderer/src/App.tsx", "currentView: currentView === 'timelines' ? 'dashboard' : currentView,", "currentView,")
edit("src/renderer/src/App.tsx", "          onNavigateTimelines={handleNavigateToTimelines}\n")
edit("src/renderer/src/App.tsx", """        {currentView === 'timelines' ? (
          <main className="fixed top-[76px] bottom-0 transition-[left,right] duration-300 ease-out" style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}>
            <SectionErrorBoundary section="Timelines">
              <TimelinesView />
            </SectionErrorBoundary>
          </main>
        ) : currentView === 'dashboard' && !isMobile ? (""", """        {currentView === 'dashboard' && !isMobile ? (""")
edit("src/renderer/src/components/layout/TopBar.tsx", ", ListOrdered, ListTodo", ", ListTodo")
edit("src/renderer/src/components/layout/TopBar.tsx", "currentView: 'dashboard' | 'library' | 'timelines'", "currentView: 'dashboard' | 'library'")
remove_matching_lines("src/renderer/src/components/layout/TopBar.tsx", lambda s: "onNavigateTimelines" in s, 2)
edit("src/renderer/src/components/layout/TopBar.tsx", """
              <button
                onClick={onNavigateTimelines}
                className={\u0060px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 \u0024{currentView === 'timelines' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}\u0060}
                role="tab"
                aria-selected={currentView === 'timelines'}
                aria-label="Timelines"
              >
                <ListOrdered className="w-4 h-4" />
                <span>Timelines</span>
              </button>
""".replace("\u0060", "\x60").replace("\u0024", "$"))
edit("src/renderer/src/contexts/NavigationContext.tsx", "view: 'dashboard' | 'library' | 'timelines'", "view: 'dashboard' | 'library'")
remove_matching_lines("src/shared/ipcChannels.ts", lambda s: s.lstrip().startswith("timelines") and "'timelines:" in s, 8)
edit("src/shared/ipcChannelMap.ts", """  // Timelines
  timelinesGetPlexPlaylists: IPC_CHANNELS.timelinesGetPlexPlaylists,
  timelinesGetRecipe: IPC_CHANNELS.timelinesGetRecipe,
  timelinesListParserPlugins: IPC_CHANNELS.timelinesListParserPlugins,
  timelinesListRecipes: IPC_CHANNELS.timelinesListRecipes,
  timelinesRemoveParserPlugin: IPC_CHANNELS.timelinesRemoveParserPlugin,
  timelinesResolveTimeline: IPC_CHANNELS.timelinesResolveTimeline,
  timelinesSaveParserPlugin: IPC_CHANNELS.timelinesSaveParserPlugin,
  timelinesSyncPlexPlaylist: IPC_CHANNELS.timelinesSyncPlexPlaylist,

""")

# Prevent accidental deletion of unrelated code: only known integration files may be edited.
allowed = set(dedicated) | {
    ".gitignore", "electron-builder.yml", "src/main/index.ts",
    "src/main/ipc/utils/OperationRequestRegistry.ts", "src/preload/index.ts",
    "src/renderer/src/App.tsx", "src/renderer/src/components/layout/TopBar.tsx",
    "src/renderer/src/contexts/NavigationContext.tsx",
    "src/shared/ipcChannels.ts", "src/shared/ipcChannelMap.ts",
}
changed = set(subprocess.check_output(["git", "diff", "--name-only"]).decode().splitlines())
changed |= set(subprocess.check_output(["git", "ls-files", "--deleted"]).decode().splitlines())
unexpected = changed - allowed
if unexpected:
    raise RuntimeError(f"Unexpected edits in {sorted(unexpected)}")
remaining = subprocess.run(["git", "grep", "-l", "-i", "timelines", "--", "src", "data", "tests"], text=True, capture_output=True)
if remaining.returncode == 0:
    raise RuntimeError(f"Timeline references remain:\n{remaining.stdout}")
if remaining.returncode != 1:
    raise RuntimeError(remaining.stderr)
print(f"Removed {len(dedicated)} timeline-only files, updated {len(changed - set(dedicated))} integration files")
