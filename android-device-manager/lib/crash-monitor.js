const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class CrashMonitor extends EventEmitter {
  constructor(adbPath, crashDir) {
    super();
    this.adbPath = adbPath || 'adb';
    this.crashDir = crashDir;
    this.process = null;
    this.serial = null;
    this.buffer = [];
    this.maxBuffer = 200;
    this.collecting = false;
    this.collectLines = [];
    this.collectRemaining = 0;
    this.crashType = null;
    this.crashes = [];
  }

  _execAdb(args) {
    return new Promise((resolve) => {
      const fullArgs = this.serial ? ['-s', this.serial, ...args] : args;
      execFile(this.adbPath, fullArgs, { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : stdout);
      });
    });
  }

  async _captureContext() {
    const [activityDump, windowDump] = await Promise.all([
      this._execAdb(['shell', 'dumpsys', 'activity', 'top']),
      this._execAdb(['shell', 'dumpsys', 'window', 'windows']),
    ]);

    let activity = '';
    const actMatch = activityDump.match(/ACTIVITY\s+(\S+)\s/);
    if (actMatch) activity = actMatch[1];

    let focusedWindow = '';
    const winMatch = windowDump.match(/mCurrentFocus=Window\{[^}]*\s+(\S+)\}/);
    if (winMatch) focusedWindow = winMatch[1];

    return { activity: activity || focusedWindow || 'unknown', rawActivity: activityDump.slice(0, 2000) };
  }

  start(serial) {
    this.stop();
    this.serial = serial;
    const args = serial
      ? ['-s', serial, 'logcat', '-v', 'time']
      : ['logcat', '-v', 'time'];

    this.process = spawn(this.adbPath, args);

    let partial = '';
    this.process.stdout.on('data', (chunk) => {
      const text = partial + chunk.toString();
      const lines = text.split('\n');
      partial = lines.pop();
      for (const line of lines) {
        this._processLine(line);
      }
    });

    this.process.on('close', () => {
      this.process = null;
    });

    this.process.on('error', () => {
      this.process = null;
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.serial = null;
    this.buffer = [];
    this.collecting = false;
    this.collectLines = [];
  }

  isRunning() {
    return this.process !== null;
  }

  _processLine(line) {
    this.buffer.push(line);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    if (this.collecting) {
      this.collectLines.push(line);
      this.collectRemaining--;
      if (this.collectRemaining <= 0) {
        this._finishCrash();
      }
      return;
    }

    if (/FATAL EXCEPTION/i.test(line)) {
      this._startCollect('CRASH', line);
    } else if (/ANR in/i.test(line)) {
      this._startCollect('ANR', line);
    } else if (/FATAL signal/i.test(line)) {
      this._startCollect('NATIVE_CRASH', line);
    }
  }

  _startCollect(type, triggerLine) {
    this.collecting = true;
    this.crashType = type;
    const contextBefore = this.buffer.slice(-30, -1);
    this.collectLines = [...contextBefore, triggerLine];
    this.collectRemaining = 30;
  }

  async _finishCrash() {
    this.collecting = false;
    const now = new Date();
    const stacktrace = this.collectLines.join('\n');

    let app = 'unknown';
    const pidMatch = this.collectLines.find((l) => /FATAL EXCEPTION|ANR in/i.test(l));
    if (pidMatch) {
      const appMatch = pidMatch.match(/Process:\s*(\S+)/i) || pidMatch.match(/ANR in\s+(\S+)/i);
      if (appMatch) app = appMatch[1];
    }

    let context = { activity: 'unknown', rawActivity: '' };
    try {
      context = await this._captureContext();
    } catch {}

    const crash = {
      time: now.toISOString(),
      timeLocal: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`,
      type: this.crashType,
      app,
      activity: context.activity,
      preview: this.collectLines.slice(0, 5).join('\n'),
      stacktrace,
      file: null,
      summary: null,
    };

    const filePath = this._saveCrashLog(now, crash, stacktrace);
    crash.file = filePath;
    this.crashes.push(crash);

    this.emit('crash', crash);
    this.collectLines = [];
  }

  _saveCrashLog(now, crash, stacktrace) {
    const today = now.toISOString().slice(0, 10);
    const dir = path.join(this.crashDir, today);
    fs.mkdirSync(dir, { recursive: true });

    const time = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;
    const fileName = `${crash.type.toLowerCase()}_${time}.log`;
    const filePath = path.join(dir, fileName);

    const header = `Type: ${crash.type}\nApp: ${crash.app}\nTime: ${crash.time}\nDevice: ${this.serial}\n${'='.repeat(60)}\n\n`;
    fs.writeFileSync(filePath, header + stacktrace, 'utf-8');
    return filePath;
  }

  getHistory() {
    return [...this.crashes].reverse();
  }

  clearHistory() {
    this.crashes = [];
  }
}

module.exports = CrashMonitor;
