const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const AdbManager = require('./lib/adb-manager');
const ScrcpyManager = require('./lib/scrcpy-manager');
const DeviceMonitor = require('./lib/device-monitor');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let mainWindow;
let adb;
let scrcpyMgr;
let deviceMonitor;
let geminiChat = null;

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function initGemini(apiKey) {
  if (!apiKey) return null;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `당신은 Android QA 전문 어시스턴트입니다. 다음 역할을 수행합니다:
- Android 디바이스 로그(logcat) 분석 및 오류 원인 파악
- ADB 명령어 추천 및 사용법 안내
- 앱 크래시, ANR, 성능 이슈 분석
- QA 테스트 케이스 관련 도움
한국어로 답변하고, 기술적 내용은 정확하게 전달합니다. 코드나 명령어는 코드 블록으로 감싸줍니다.`,
    });
    geminiChat = model.startChat({ history: [] });
    return geminiChat;
  } catch {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Android Device Manager',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function setupIpcHandlers() {
  adb = new AdbManager();
  const fs = require('fs');
  const isWin = process.platform === 'win32';

  const adbBin = isWin ? 'adb.exe' : 'adb';
  const scrcpyPacked = path.join(process.resourcesPath, 'scrcpy');
  const scrcpyDev = path.join(__dirname, 'vendor', 'scrcpy');
  let scrcpyDir = null;

  if (fs.existsSync(scrcpyPacked)) {
    scrcpyDir = scrcpyPacked;
  } else if (fs.existsSync(scrcpyDev)) {
    scrcpyDir = scrcpyDev;
  }

  if (scrcpyDir && fs.existsSync(path.join(scrcpyDir, adbBin))) {
    adb.adbPath = path.join(scrcpyDir, adbBin);
  }

  scrcpyMgr = new ScrcpyManager(scrcpyDir);
  deviceMonitor = new DeviceMonitor(adb);

  deviceMonitor.on('devices-changed', (devices) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('devices-changed', devices);
    }
  });

  ipcMain.handle('adb:get-devices', () => adb.getDevices());
  ipcMain.handle('adb:get-device-info', (_, serial) => adb.getDeviceInfo(serial));

  ipcMain.handle('adb:install-apk', async (_, serial) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'APK Files', extensions: ['apk'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return adb.installApk(serial, result.filePaths[0]);
  });
  ipcMain.handle('adb:install-apk-path', (_, serial, apkPath) => adb.installApk(serial, apkPath));

  ipcMain.handle('adb:clean-install', async (_, serial, pkgName) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'APK Files', extensions: ['apk'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    try { await adb.forceStop(serial, pkgName); } catch {}
    try { await adb.uninstallPackage(serial, pkgName); } catch {}
    return adb.installApk(serial, result.filePaths[0]);
  });

  ipcMain.handle('adb:list-packages', (_, serial, filter) => adb.listPackages(serial, filter));
  ipcMain.handle('adb:uninstall-package', (_, serial, pkg) => adb.uninstallPackage(serial, pkg));
  ipcMain.handle('adb:launch-app', (_, serial, pkg) => adb.launchApp(serial, pkg));
  ipcMain.handle('adb:force-stop', (_, serial, pkg) => adb.forceStop(serial, pkg));
  ipcMain.handle('adb:clear-data', (_, serial, pkg) => adb.clearData(serial, pkg));

  ipcMain.handle('adb:start-logcat', (_, serial, filters) => {
    adb.startLogcat(serial, filters, (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('logcat-line', line);
      }
    });
    return { success: true };
  });
  ipcMain.handle('adb:stop-logcat', () => {
    adb.stopLogcat();
    return { success: true };
  });
  ipcMain.handle('adb:clear-logcat', (_, serial) => adb.clearLogcat(serial));

  ipcMain.handle('adb:list-files', (_, serial, remotePath) => adb.listFiles(serial, remotePath));
  ipcMain.handle('adb:pull-file', async (_, serial, remotePath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.basename(remotePath),
    });
    if (result.canceled) return { success: false, canceled: true };
    return adb.pullFile(serial, remotePath, result.filePath);
  });
  ipcMain.handle('adb:push-file', async (_, serial, remotePath) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return adb.pushFile(serial, result.filePaths[0], remotePath);
  });
  ipcMain.handle('adb:delete-file', (_, serial, remotePath) => adb.deleteFile(serial, remotePath));

  scrcpyMgr.onExit = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scrcpy-exited');
    }
  };
  ipcMain.handle('scrcpy:start', (_, serial, options) => scrcpyMgr.start(serial, options));
  ipcMain.handle('scrcpy:stop', () => scrcpyMgr.stop());
  ipcMain.handle('scrcpy:is-running', () => scrcpyMgr.isRunning());

  adb._onScreenRecordExit = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screen-record-finished');
    }
  };

  ipcMain.handle('adb:start-record', (_, serial) => {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
    const remotePath = `/sdcard/rec_${ts}.mp4`;
    return adb.startScreenRecord(serial, remotePath);
  });

  ipcMain.handle('adb:stop-record', async (_, serial) => {
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(__dirname, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}-${now.getSeconds().toString().padStart(2,'0')}`;
    const localPath = path.join(dir, `record_${time}.mp4`);
    return adb.stopScreenRecordAndPull(localPath);
  });

  ipcMain.handle('adb:is-recording', () => adb.isScreenRecording());
  ipcMain.handle('adb:screencap', (_, serial) => adb.screencap(serial));

  ipcMain.handle('adb:dump-ui', (_, serial) => adb.dumpUi(serial));
  ipcMain.handle('adb:running-app-info', (_, serial, pkg) => adb.getRunningAppInfo(serial, pkg));
  ipcMain.handle('adb:foreground-pkg', (_, serial) => adb.getForegroundPkg(serial));
  ipcMain.handle('adb:pair', (_, address, code) => adb.pair(address, code));
  ipcMain.handle('adb:connect-wireless', (_, address) => adb.connectWireless(address));
  ipcMain.handle('adb:disconnect-wireless', (_, address) => adb.disconnectWireless(address));

  ipcMain.handle('adb:input-tap', (_, serial, x, y) => adb.inputTap(serial, x, y));
  ipcMain.handle('adb:input-swipe', (_, serial, x1, y1, x2, y2, dur) => adb.inputSwipe(serial, x1, y1, x2, y2, dur));
  ipcMain.handle('adb:input-key', (_, serial, keycode) => adb.inputKeyEvent(serial, keycode));

  ipcMain.handle('adb:save-screenshot', async (_, base64Data) => {
    const fs = require('fs');
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(__dirname, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}-${now.getSeconds().toString().padStart(2,'0')}`;
    const fileName = `screenshot_${time}.png`;
    const filePath = path.join(dir, fileName);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath, dir };
  });

  ipcMain.handle('shell:open-screenshot-folder', async () => {
    const fs = require('fs');
    const { shell } = require('electron');
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(__dirname, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle('dialog:save-file', async (_, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }],
    });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('fs:write-file', async (_, filePath, content) => {
    const fs = require('fs').promises;
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  });

  function safeName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
  }

  ipcMain.handle('adb:pull-all-logs', async (_, serial, remotePaths) => {
    const fs = require('fs');

    const today = new Date().toISOString().slice(0, 10);
    const logsDir = path.join(__dirname, 'logs', today);
    fs.mkdirSync(logsDir, { recursive: true });

    const paths = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
    let totalPulled = 0;

    try {
      for (const remotePath of paths) {
        const files = await adb.listFiles(serial, remotePath);
        const realFiles = files.filter((f) => !f.isDirectory);
        for (const f of realFiles) {
          const localPath = path.join(logsDir, safeName(f.name));
          await adb.pullFile(serial, f.fullPath, localPath);
          totalPulled++;
        }
      }

      if (!totalPulled) return { success: false, error: '로그 파일이 없습니다.' };
      return { success: true, logsDir, count: totalPulled };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('shell:open-folder', async (_, folderPath) => {
    const { shell } = require('electron');
    shell.openPath(folderPath);
  });

  ipcMain.handle('fs:read-logs-dir', async (_, dirPath) => {
    const fsP = require('fs').promises;
    try {
      const files = await fsP.readdir(dirPath);
      let combined = '';
      for (const f of files) {
        if (!f.endsWith('.txt') && !f.endsWith('.log')) continue;
        const content = await fsP.readFile(path.join(dirPath, f), 'utf-8');
        combined += `\n===== ${f} =====\n${content}\n`;
        if (combined.length > 100000) break;
      }
      return { success: true, text: combined.slice(0, 100000) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('adb:fetch-recent-log', async (_, serial) => {
    try {
      const log = await adb._execText(['logcat', '-d', '-t', '3000'], serial);
      return { success: true, text: log };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // --- Gemini AI ---
  ipcMain.handle('gemini:get-api-key', () => {
    const cfg = loadConfig();
    return cfg.geminiApiKey || '';
  });

  ipcMain.handle('gemini:set-api-key', (_, key) => {
    const cfg = loadConfig();
    cfg.geminiApiKey = key;
    saveConfig(cfg);
    geminiChat = null;
    if (key) initGemini(key);
    return { success: true };
  });

  ipcMain.handle('gemini:chat', async (_, message) => {
    const cfg = loadConfig();
    if (!cfg.geminiApiKey) return { success: false, error: 'API 키가 설정되지 않았습니다.' };

    if (!geminiChat) {
      initGemini(cfg.geminiApiKey);
    }
    if (!geminiChat) return { success: false, error: 'Gemini 초기화 실패' };

    try {
      const result = await geminiChat.sendMessage(message);
      const text = result.response.text();
      return { success: true, text };
    } catch (e) {
      if (e.message && e.message.includes('API_KEY_INVALID')) {
        return { success: false, error: 'API_KEY_INVALID' };
      }
      geminiChat = null;
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('gemini:reset', () => {
    const cfg = loadConfig();
    geminiChat = null;
    if (cfg.geminiApiKey) initGemini(cfg.geminiApiKey);
    return { success: true };
  });
}

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  deviceMonitor.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  deviceMonitor.stop();
  adb.stopLogcat();
  adb.stopScreenRecord();
  scrcpyMgr.stop();
  if (process.platform !== 'darwin') app.quit();
});
