const fs = require('fs');
const path = require('path');

function extractChannels(dir, regex) {
  const channels = new Set();
  const files = fs.readdirSync(dir, { recursive: true });
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isFile() && (file.endsWith('.ts') || file.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        channels.add(match[1]);
      }
    }
  }
  return channels;
}

const preloadRegex = /ipcRenderer\.invoke\(\s*'([^']+)'/g;
const mainRegex = /ipcMain\.handle\(\s*'([^']+)'/g;

const preloadChannels = extractChannels('src/preload/api', preloadRegex);
const mainChannels = extractChannels('src/main/ipc', mainRegex);

console.log('--- Preload but not Main ---');
for (const c of preloadChannels) {
  if (!mainChannels.has(c)) console.log(c);
}

console.log('\n--- Main but not Preload ---');
for (const c of mainChannels) {
  if (!preloadChannels.has(c)) {
    // Filter out internal or generic ones that might not be in preload
    if (!c.includes(':list') && !c.includes(':count') && !c.includes('app:getVersion')) {
       console.log(c);
    }
  }
}
