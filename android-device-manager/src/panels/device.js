const APP_PKGS = ['com.overdare.overdare.dev', 'com.overdare.overdare'];

const DevicePanel = {
  appInfo: null,
  detectedPkg: null,
  _appInfoBound: false,

  init() {
    if (!this._appInfoBound) {
      this._appInfoBound = true;
      this.setupAppInfoButton();
    }
  },

  async refresh() {
    const container = document.getElementById('device-info-content');
    if (!App.currentDevice) {
      container.innerHTML = '<p style="color:var(--text-muted)">디바이스를 선택하면 정보가 표시됩니다.</p>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const info = await window.api.getDeviceInfo(App.currentDevice);
      container.innerHTML = this.renderInfo(info);
    } catch (e) {
      container.innerHTML = `<p style="color:var(--red)">정보 조회 실패: ${e.message}</p>`;
    }
  },

  setupAppInfoButton() {
    const btn = document.getElementById('fetch-app-info');
    const copyBtn = document.getElementById('copy-app-info');
    if (btn) {
      btn.addEventListener('click', () => this.fetchAppInfo());
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyAppInfo());
    }
  },

  async detectPkg() {
    if (!App.currentDevice) return null;
    try {
      const fg = await window.api.getForegroundPkg(App.currentDevice);
      if (fg && APP_PKGS.includes(fg)) return fg;
    } catch {}
    const pkgs = await window.api.listPackages(App.currentDevice);
    const names = pkgs.map(p => p.name);
    for (const candidate of APP_PKGS) {
      if (names.includes(candidate)) return candidate;
    }
    return APP_PKGS[0];
  },

  async fetchAppInfo() {
    if (!App.currentDevice) return;
    const btn = document.getElementById('fetch-app-info');
    btn.textContent = '조회 중...';
    btn.disabled = true;

    if (!this.detectedPkg) this.detectedPkg = await this.detectPkg();
    const pkg = this.detectedPkg;

    const info = await window.api.getRunningAppInfo(App.currentDevice, pkg);
    info.buildType = pkg.endsWith('.dev') ? 'DEV' : 'RELEASE';
    this.appInfo = info;

    const serverEl = document.getElementById('app-info-server');
    const unrealEl = document.getElementById('app-info-unreal');
    const appVerEl = document.getElementById('app-info-appver');

    serverEl.textContent = info.server || '-';
    unrealEl.textContent = info.unrealVersion || '-';
    appVerEl.textContent = (info.appVersion || '-') + (info.buildType ? ` (${info.buildType})` : '');

    if (info.server) serverEl.style.color = '#a6e3a1';
    if (info.unrealVersion) unrealEl.style.color = '#a6e3a1';
    if (info.appVersion) appVerEl.style.color = '#a6e3a1';

    btn.textContent = '앱 정보 조회';
    btn.disabled = false;

    document.getElementById('copy-app-info').style.display = 'inline-block';
  },

  copyAppInfo() {
    if (!this.appInfo) return;
    const ver = (this.appInfo.appVersion || '-') + (this.appInfo.buildType ? ` (${this.appInfo.buildType})` : '');
    const text = `서버환경 : ${this.appInfo.server || '-'}\n언리얼버전 : ${this.appInfo.unrealVersion || '-'}\n앱버전 : ${ver}`;
    navigator.clipboard.writeText(text);
    App.toast('앱 정보 복사됨', 'success');
  },

  renderInfo(info) {
    const storageHtml = info.storage
      ? `<div class="info-item"><label>저장공간</label><span>${App.formatBytes(info.storage.used * 1024)} / ${App.formatBytes(info.storage.total * 1024)}</span></div>
         <div class="info-item"><label>여유 공간</label><span>${App.formatBytes(info.storage.available * 1024)}</span></div>`
      : '';

    return `
      <div class="card">
        <div class="card-title">기본 정보</div>
        <div class="info-grid">
          <div class="info-item"><label>모델</label><span>${info.model || '-'}</span></div>
          <div class="info-item"><label>제조사</label><span>${info.manufacturer || '-'}</span></div>
          <div class="info-item"><label>브랜드</label><span>${info.brand || '-'}</span></div>
          <div class="info-item"><label>시리얼</label><span>${info.serial || '-'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">시스템</div>
        <div class="info-grid">
          <div class="info-item"><label>Android</label><span>${info.androidVersion || '-'}</span></div>
          <div class="info-item"><label>API Level</label><span>${info.apiLevel || '-'}</span></div>
          <div class="info-item"><label>빌드 넘버</label><span>${info.buildNumber || '-'}</span></div>
          <div class="info-item"><label>해상도</label><span>${info.resolution || '-'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">배터리 &amp; 저장공간</div>
        <div class="info-grid">
          <div class="info-item"><label>배터리</label><span>${info.batteryLevel != null ? info.batteryLevel + '%' : '-'}</span></div>
          <div class="info-item"><label>충전 상태</label><span>${info.batteryStatus || '-'}</span></div>
          ${storageHtml}
        </div>
      </div>
    `;
  },
};
