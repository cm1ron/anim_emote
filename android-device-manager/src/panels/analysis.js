const PRD_EXTS = ['.pdf', '.md', '.txt'];
const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

const Analysis = {
  prdFiles: [],
  figmaFiles: [],
  parsedData: null,
  analyzing: false,
  activeTab: 'summary',
  _results: { summary: null, testcase: null },
  _resultTypes: { summary: null, testcase: null },

  init() {
    this._initDropzone('analysis-dropzone-prd', 'prd');
    this._initDropzone('analysis-dropzone-figma', 'figma');
    document.getElementById('analysis-run').addEventListener('click', () => this.runSmartAnalysis());
    document.getElementById('analysis-clear').addEventListener('click', () => this.clearAll());
    document.getElementById('analysis-copy-result').addEventListener('click', () => this.copyResult());
    document.getElementById('analysis-save-result').addEventListener('click', () => this.saveResult());
    document.getElementById('analysis-open-folder').addEventListener('click', () => window.api.analysisOpenFolder());

    document.querySelectorAll('.analysis-tab').forEach((tab) => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.analysis-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('analysis-result-summary').style.display = tab === 'summary' ? '' : 'none';
    document.getElementById('analysis-result-testcase').style.display = tab === 'testcase' ? '' : 'none';
  },

  _initDropzone(id, type) {
    const dz = document.getElementById(id);
    const exts = type === 'prd' ? PRD_EXTS : IMG_EXTS;
    const accept = exts.join(',');

    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const list = type === 'prd' ? this.prdFiles : this.figmaFiles;
      for (const file of e.dataTransfer.files) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!exts.includes(ext)) continue;
        const filePath = window.api.getFilePath(file);
        if (list.find((f) => f.path === filePath)) continue;
        list.push({ name: file.name, path: filePath, ext });
      }
      this.parsedData = null;
      this.renderFileList();
    });
    dz.addEventListener('click', () => {
      if (type === 'figma') {
        this.openFigmaDialog();
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = accept;
        input.addEventListener('change', () => {
          for (const file of input.files) {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!exts.includes(ext)) continue;
            const filePath = window.api.getFilePath(file);
            if (this.prdFiles.find((f) => f.path === filePath)) continue;
            this.prdFiles.push({ name: file.name, path: filePath, ext });
          }
          this.parsedData = null;
          this.renderFileList();
        });
        input.click();
      }
    });
  },

  async openFigmaDialog() {
    const result = await window.api.selectFigmaFiles();
    if (!result || !result.length) return;
    let added = 0;
    for (const f of result) {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      if (!IMG_EXTS.includes(ext)) continue;
      if (this.figmaFiles.find((e) => e.path === f.path)) continue;
      this.figmaFiles.push({ name: f.name, path: f.path, ext });
      added++;
    }
    if (added) {
      this.parsedData = null;
      this.renderFileList();
      App.toast(`${added}개 이미지 추가됨`, 'success');
    }
  },

  _renderList(containerId, files) {
    const container = document.getElementById(containerId);
    if (!files.length) { container.innerHTML = ''; return; }
    const isImg = containerId.includes('figma');
    container.innerHTML = files.map((f, i) => `<div class="analysis-file-item">
      <span class="analysis-file-icon">${isImg ? '🖼' : '📄'}</span>
      <span class="analysis-file-name" title="${f.path}">${f.name}</span>
      <button class="analysis-file-remove" data-index="${i}">&times;</button>
    </div>`).join('');
    container.querySelectorAll('.analysis-file-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        files.splice(parseInt(btn.dataset.index), 1);
        this.parsedData = null;
        this.renderFileList();
      });
    });
  },

  renderFileList() {
    this._renderList('analysis-file-list-prd', this.prdFiles);
    this._renderList('analysis-file-list-figma', this.figmaFiles);

    const type = this.detectAnalysisType();
    const runBtn = document.getElementById('analysis-run');
    const labels = { prd: '🔍 PRD 분석', figma: '🔍 피그마 UI 분석', compare: '🔍 PRD vs 피그마 비교 분석' };
    runBtn.textContent = labels[type] || '🔍 분석';
  },

  detectAnalysisType() {
    const hasPrd = this.prdFiles.length > 0;
    const hasFigma = this.figmaFiles.length > 0;
    if (hasPrd && hasFigma) return 'compare';
    if (hasPrd) return 'prd';
    if (hasFigma) return 'figma';
    return null;
  },

  async runSmartAnalysis() {
    if (this.analyzing) return;
    if (!this.prdFiles.length && !this.figmaFiles.length) return App.toast('분석할 파일을 먼저 추가해주세요', 'error');

    const type = this.detectAnalysisType();
    if (!type) return App.toast('분석할 수 있는 파일이 없습니다', 'error');

    this.analyzing = true;
    document.getElementById('analysis-run').disabled = true;
    this.showActions(false);

    const summaryEl = document.getElementById('analysis-result-summary');
    const testcaseEl = document.getElementById('analysis-result-testcase');
    const modeDesc = { prd: 'PRD 문서', figma: '피그마 스크린샷', compare: 'PRD + 피그마' };

    summaryEl.innerHTML = `<div class="analysis-loading"><div class="loading-spinner"></div> ${modeDesc[type]} 분석 중...</div>`;
    testcaseEl.innerHTML = `<div class="analysis-loading"><div class="loading-spinner"></div> 테스트케이스 생성 대기 중...</div>`;
    this.switchTab('summary');

    try {
      if (!this.parsedData) {
        const allFiles = [...this.prdFiles, ...this.figmaFiles];
        const filePaths = allFiles.map((f) => f.path);
        const parsed = await window.api.analysisParseFiles(filePaths);
        if (!parsed.success) {
          App.toast(`파일 파싱 실패: ${parsed.error}`, 'error');
          this.analyzing = false;
          document.getElementById('analysis-run').disabled = false;
          return;
        }
        if (parsed.errors && parsed.errors.length) {
          parsed.errors.forEach((e) => App.toast(`${e.name}: ${e.error}`, 'error'));
        }
        this.parsedData = { texts: parsed.texts, images: parsed.images };
      }

      const [summaryResult, testcaseResult] = await Promise.all([
        window.api.analysisRun(type, this.parsedData),
        window.api.analysisRunTestcase(type, this.parsedData),
      ]);

      if (summaryResult.success) {
        summaryEl.innerHTML = `<div class="analysis-content">${this.formatMarkdown(summaryResult.text)}</div>`;
        this._results.summary = summaryResult.text;
        this._resultTypes.summary = type;
      } else {
        summaryEl.innerHTML = `<div class="analysis-error">${summaryResult.error}</div>`;
      }

      if (testcaseResult.success) {
        testcaseEl.innerHTML = `<div class="analysis-content">${this.formatMarkdown(testcaseResult.text)}</div>`;
        this._results.testcase = testcaseResult.text;
        this._resultTypes.testcase = type;
      } else {
        testcaseEl.innerHTML = `<div class="analysis-error">${testcaseResult.error}</div>`;
      }

      if (summaryResult.success || testcaseResult.success) {
        this.showActions(true);
        App.toast('분석 완료', 'success');
      }
    } catch (e) {
      summaryEl.innerHTML = `<div class="analysis-error">${e.message}</div>`;
      testcaseEl.innerHTML = `<div class="analysis-error">${e.message}</div>`;
    }

    this.analyzing = false;
    document.getElementById('analysis-run').disabled = false;
  },

  showActions(visible) {
    document.getElementById('analysis-result-actions').style.display = visible ? 'flex' : 'none';
  },

  formatMarkdown(text) {
    let html = text;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${escaped}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    html = html.replace(/((?:^\|.+\|$\n?){2,})/gm, (table) => {
      const rows = table.trim().split('\n').filter((r) => r.trim());
      if (rows.length < 2) return table;
      const parseRow = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      const headers = parseRow(rows[0]);
      const isSeparator = (r) => /^\|[\s:|-]+\|$/.test(r.trim());
      const dataStart = isSeparator(rows[1]) ? 2 : 1;

      let t = '<table><thead><tr>';
      headers.forEach((h) => { t += `<th>${h}</th>`; });
      t += '</tr></thead><tbody>';
      for (let i = dataStart; i < rows.length; i++) {
        const cells = parseRow(rows[i]);
        t += '<tr>';
        cells.forEach((c) => { t += `<td>${c.replace(/\\n/g, '<br>')}</td>`; });
        t += '</tr>';
      }
      t += '</tbody></table>';
      return t;
    });

    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
    html = html.replace(/\n/g, '<br>');
    return html;
  },

  copyResult() {
    const text = this._results[this.activeTab];
    if (text) {
      navigator.clipboard.writeText(text);
      App.toast('복사됨', 'success');
    }
  },

  async saveResult() {
    const text = this._results[this.activeTab];
    const type = this._resultTypes[this.activeTab];
    if (!text || !type) return;
    const saveType = this.activeTab === 'testcase' ? 'testcase' : type;
    const result = await window.api.analysisSave(saveType, text);
    if (result.success) {
      const fileName = result.filePath.split(/[\\/]/).pop();
      App.toast(`저장 완료: ${fileName}`, 'success');
    }
  },

  clearAll() {
    this.prdFiles = [];
    this.figmaFiles = [];
    this.parsedData = null;
    this._results = { summary: null, testcase: null };
    this._resultTypes = { summary: null, testcase: null };
    this.renderFileList();
    document.getElementById('analysis-result-summary').innerHTML = '<div class="analysis-placeholder"><p>파일을 추가하고 분석 버튼을 눌러주세요.</p></div>';
    document.getElementById('analysis-result-testcase').innerHTML = '<div class="analysis-placeholder"><p>파일을 추가하고 분석 버튼을 눌러주세요.</p></div>';
    document.getElementById('analysis-run').textContent = '🔍 분석';
    this.showActions(false);
    this.switchTab('summary');
    App.toast('초기화됨', 'info');
  },
};

document.addEventListener('DOMContentLoaded', () => Analysis.init());
