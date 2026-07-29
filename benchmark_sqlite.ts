import { performance } from 'perf_hooks';
import { getDatabase } from './src/main/database/Database';
import { app } from 'electron';
import { BetterSQLiteService } from './src/main/database/BetterSQLiteService';

// Mock electron
jest.mock('electron', () => ({
  app: { getPath: () => './' }
}));

async function run() {
  console.log('starting benchmark');
}
run();
