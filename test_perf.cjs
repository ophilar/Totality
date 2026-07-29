const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    albumId INTEGER,
    providerId TEXT UNIQUE
  );
`);

const insert = db.prepare('INSERT OR REPLACE INTO tracks (title, albumId, providerId) VALUES (?, ?, ?)');

const numItems = 1000;
const tracks = Array.from({ length: numItems }, (_, i) => ({ title: `Track ${i}`, albumId: 1, providerId: `kodi-track-${i}` }));

// N+1 style
let start = performance.now();
for (const track of tracks) {
  insert.run(track.title, track.albumId, track.providerId);
}
let end = performance.now();
console.log(`N+1 approach took ${end - start} ms`);

// Promise.all style equivalent (in JS event loop, not fully representative of async I/O but shows batching potential if we used a transaction or async ops)

// Transaction batch style
start = performance.now();
const insertMany = db.transaction((tracks) => {
  for (const track of tracks) {
    insert.run(track.title, track.albumId, track.providerId);
  }
});
insertMany(tracks);
end = performance.now();
console.log(`Transaction batch approach took ${end - start} ms`);
