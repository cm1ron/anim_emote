const AiChat = {
  sending: false,
  logContext: null,

  init() {
    document.getElementById('ai-send').addEventListener('click', () => this.send());
    document.getElementById('ai-reset').addEventListener('click', () => this.reset());
    document.getElementById('ai-settings').addEventListener('click', () => this.showApiKeyModal());
    document.getElementById('ai-attach-log').addEventListener('click', () => this.attachLog());

    document.getElementById('api-key-save').addEventListener('click', () => this.saveApiKey());
    document.getElementById('api-key-cancel').addEventListener('click', () => this.hideApiKeyModal());

    const input = document.getElementById('ai-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    input.addEventListener('input', () => this.autoResize(input));

    this.checkApiKey();
  },

  async checkApiKey() {
    const key = await window.api.geminiGetApiKey();
    if (!key) {
      this.showApiKeyModal();
    }
  },

  showApiKeyModal() {
    document.getElementById('api-key-modal').style.display = 'flex';
    window.api.geminiGetApiKey().then((key) => {
      document.getElementById('api-key-input').value = key || '';
      document.getElementById('api-key-input').focus();
    });
  },

  hideApiKeyModal() {
    document.getElementById('api-key-modal').style.display = 'none';
  },

  async saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) {
      App.toast('API 키를 입력해주세요', 'error');
      return;
    }
    await window.api.geminiSetApiKey(key);
    this.hideApiKeyModal();
    App.toast('API 키 저장됨', 'success');
  },

  autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  },

  addMessage(role, html, extra) {
    const container = document.getElementById('ai-messages');
    const welcome = container.querySelector('.ai-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;

    if (extra) {
      const badge = document.createElement('span');
      badge.className = 'ai-log-badge';
      badge.textContent = extra;
      div.appendChild(badge);
      div.appendChild(document.createElement('br'));
    }

    const content = document.createElement('span');
    content.innerHTML = html;
    div.appendChild(content);

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  showTyping() {
    const container = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = 'ai-typing';
    div.id = 'ai-typing-indicator';
    div.textContent = '답변 생성 중...';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  hideTyping() {
    const el = document.getElementById('ai-typing-indicator');
    if (el) el.remove();
  },

  formatResponse(text) {
    let html = text;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${escaped}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
  },

  async send() {
    if (this.sending) return;

    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;

    let message = text;
    let badge = null;

    if (this.logContext) {
      message = `[첨부된 로그]\n${this.logContext}\n\n[질문]\n${text}`;
      badge = '📎 로그 첨부됨';
      this.logContext = null;
      document.getElementById('ai-attach-log').classList.remove('btn-accent');
    }

    this.addMessage('user', text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'), badge);
    input.value = '';
    input.style.height = 'auto';

    this.sending = true;
    document.getElementById('ai-send').disabled = true;
    this.showTyping();

    const result = await window.api.geminiChat(message);
    this.hideTyping();

    if (result.success) {
      this.addMessage('assistant', this.formatResponse(result.text));
    } else {
      if (result.error && result.error.includes('API_KEY')) {
        this.addMessage('error', 'API 키가 유효하지 않습니다. ⚙ 버튼으로 키를 확인해주세요.');
      } else {
        this.addMessage('error', `오류: ${result.error}`);
      }
    }

    this.sending = false;
    document.getElementById('ai-send').disabled = false;
    document.getElementById('ai-input').focus();
  },

  async reset() {
    await window.api.geminiReset();
    const container = document.getElementById('ai-messages');
    container.innerHTML = `
      <div class="ai-welcome">
        <p>Gemini AI 어시스턴트입니다.</p>
        <p>로그 분석, ADB 명령어, QA 관련 질문을 해보세요.</p>
      </div>`;
    this.logContext = null;
    document.getElementById('ai-attach-log').classList.remove('btn-accent');
    App.toast('대화 초기화됨', 'info');
  },

  async attachLog() {
    if (!App.currentDevice) {
      App.toast('디바이스를 먼저 연결해주세요', 'error');
      return;
    }

    const btn = document.getElementById('ai-attach-log');
    btn.textContent = '📎 수집 중...';
    btn.disabled = true;

    let combined = '';

    try {
      const [logResult, uiResult] = await Promise.all([
        window.api.fetchRecentLog(App.currentDevice),
        window.api.dumpUi(App.currentDevice),
      ]);

      if (uiResult.success && uiResult.xml) {
        combined += `[현재 화면 UI 트리]\n${uiResult.xml.slice(0, 30000)}\n\n`;
      }

      if (logResult.success && logResult.text.trim()) {
        combined += `[최근 디바이스 로그]\n${logResult.text.trim().slice(0, 60000)}`;
      }
    } catch (e) {
      App.toast(`수집 실패: ${e.message}`, 'error');
    }

    if (combined.trim()) {
      this.logContext = combined;
      btn.classList.add('btn-accent');
      App.toast(`디바이스 정보 ${combined.length.toLocaleString()}자 첨부됨 — 질문을 입력하세요`, 'success');
    } else {
      App.toast('수집된 데이터가 없습니다', 'error');
    }

    btn.textContent = '📎 디바이스';
    btn.disabled = false;
  },
};

document.addEventListener('DOMContentLoaded', () => AiChat.init());
