const APP_PKG = 'com.overdare.overdare.dev';

const DevicePanel = {
  appInfo: null,
  _appInfoBound: false,

  init() {
    if (!this._appInfoBound) {
      this._appInfoBound = true;
      this.setupAppInfoButton();
    }
  },

  async refresh() {
    const container = document.getElementById('device-info-content');
    const visual = document.getElementById('device-visual');
    if (!App.currentDevice) {
      container.innerHTML = '<p style="color:var(--text-muted)">디바이스를 선택하면 정보가 표시됩니다.</p>';
      if (visual) visual.innerHTML = '';
      return;
    }

    container.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const info = await window.api.getDeviceInfo(App.currentDevice);
      container.innerHTML = this.renderInfo(info);
      if (visual) visual.innerHTML = this.renderDeviceSvg(info);
    } catch (e) {
      container.innerHTML = `<p style="color:var(--red)">정보 조회 실패: ${e.message}</p>`;
    }
  },

  _isTablet(model) {
    if (!model) return false;
    const m = model.toLowerCase();
    return m.includes('tab') || m.startsWith('sm-t') || m.startsWith('sm-x');
  },

  renderDeviceSvg(info) {
    const isTab = this._isTablet(info.model);
    const model = info.model || 'Unknown';
    const android = info.androidVersion || '?';
    const res = info.resolution || '? x ?';
    const battery = info.batteryLevel != null ? `${info.batteryLevel}%` : '?';
    const manufacturer = (info.manufacturer || '').toUpperCase();

    if (isTab) {
      return `<svg viewBox="0 0 280 200" width="280" height="200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="10" width="260" height="180" rx="16" fill="#252536" stroke="#89b4fa" stroke-width="2"/>
        <rect x="22" y="22" width="236" height="156" rx="4" fill="#1e1e2e"/>
        <circle cx="14" cy="100" r="3" fill="#45475a"/>
        <text x="140" y="75" text-anchor="middle" fill="#89b4fa" font-size="14" font-weight="600">${manufacturer}</text>
        <text x="140" y="98" text-anchor="middle" fill="#cdd6f4" font-size="12">${model}</text>
        <text x="140" y="118" text-anchor="middle" fill="#a6adc8" font-size="11">Android ${android}</text>
        <text x="140" y="138" text-anchor="middle" fill="#a6adc8" font-size="10">${res}</text>
        <text x="140" y="156" text-anchor="middle" fill="#a6e3a1" font-size="10">🔋 ${battery}</text>
      </svg>`;
    }

    return `<svg viewBox="0 0 160 300" width="160" height="300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="140" height="280" rx="20" fill="#252536" stroke="#89b4fa" stroke-width="2"/>
      <rect x="22" y="40" width="116" height="220" rx="4" fill="#1e1e2e"/>
      <rect x="60" y="20" width="40" height="6" rx="3" fill="#45475a"/>
      <circle cx="80" cy="274" r="6" stroke="#45475a" stroke-width="1.5" fill="none"/>
      <text x="80" y="110" text-anchor="middle" fill="#89b4fa" font-size="13" font-weight="600">${manufacturer}</text>
      <text x="80" y="135" text-anchor="middle" fill="#cdd6f4" font-size="11">${model}</text>
      <text x="80" y="158" text-anchor="middle" fill="#a6adc8" font-size="10">Android ${android}</text>
      <text x="80" y="178" text-anchor="middle" fill="#a6adc8" font-size="9">${res}</text>
      <text x="80" y="200" text-anchor="middle" fill="#a6e3a1" font-size="10">🔋 ${battery}</text>
    </svg>`;
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

  async fetchAppInfo() {
    if (!App.currentDevice) return;
    const btn = document.getElementById('fetch-app-info');
    btn.textContent = '조회 중...';
    btn.disabled = true;

    const info = await window.api.getRunningAppInfo(App.currentDevice, APP_PKG);
    this.appInfo = info;

    const serverEl = document.getElementById('app-info-server');
    const unrealEl = document.getElementById('app-info-unreal');
    const appVerEl = document.getElementById('app-info-appver');

    serverEl.textContent = info.server || '-';
    unrealEl.textContent = info.unrealVersion || '-';
    appVerEl.textContent = info.appVersion || '-';

    if (info.server) serverEl.style.color = '#a6e3a1';
    if (info.unrealVersion) unrealEl.style.color = '#a6e3a1';
    if (info.appVersion) appVerEl.style.color = '#a6e3a1';

    btn.textContent = '앱 정보 조회';
    btn.disabled = false;

    document.getElementById('copy-app-info').style.display = 'inline-block';
  },

  copyAppInfo() {
    if (!this.appInfo) return;
    const text = `서버환경 : ${this.appInfo.server || '-'}\n언리얼버전 : ${this.appInfo.unrealVersion || '-'}\n앱버전 : ${this.appInfo.appVersion || '-'}`;
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
