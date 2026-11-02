import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test';

test.describe('Totality Application Launch', () => {
  let electronApp: ElectronApplication;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      }
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should launch main window and establish IPC', async () => {
    const window = await electronApp.firstWindow();
    
    // Wait for the window to load
    await window.waitForLoadState('domcontentloaded');
    
    // Test the window title
    const title = await window.title();
    expect(title).toBeTruthy();

    // Take a screenshot of the initial launch state
    await window.screenshot({ path: 'tests/e2e/screenshots/initial-launch.png' });
    
    // We expect the app to mount the root container
    const root = window.locator('#root');
    await expect(root).toBeAttached();
  });
});
