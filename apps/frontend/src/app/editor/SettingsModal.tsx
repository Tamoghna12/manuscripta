import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callLLM, ollamaListModels } from '../../api/client';
import {
  PROVIDER_PRESETS,
  type AppSettings,
  type CompileEngine,
  type LLMProvider,
} from '../../utils/settingsUtils';

interface SettingsModalProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onClose: () => void;
}

export default function SettingsModal({ settings, setSettings, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const [settingsTab, setSettingsTab] = useState<'providers' | 'general' | 'grammar' | 'compile'>('providers');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testConnStatus, setTestConnStatus] = useState<'' | 'testing' | 'success' | 'failed'>('');

  const {
    provider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    searchEndpoint,
    searchApiKey,
    searchModel,
    visionEndpoint,
    visionApiKey,
    visionModel,
    compileEngine,
    grammarEnabled,
    grammarModel,
  } = settings;

  const handleProviderChange = useCallback((p: LLMProvider) => {
    const preset = PROVIDER_PRESETS[p];
    setSettings((prev) => ({
      ...prev,
      provider: p,
      llmEndpoint: preset.endpoint || prev.llmEndpoint,
      llmModel: preset.model || prev.llmModel,
      llmApiKey: p === 'ollama' ? '' : prev.llmApiKey,
    }));
    setTestConnStatus('');
    if (p === 'ollama') {
      ollamaListModels(preset.endpoint.replace(/\/v1$/, '')).then((res) => {
        if (res.ok) setOllamaModels(res.models);
      });
    }
  }, [setSettings]);

  const handleTestConnection = useCallback(async () => {
    setTestConnStatus('testing');
    try {
      const res = await callLLM({
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        llmConfig: { endpoint: llmEndpoint, apiKey: llmApiKey, model: llmModel },
      });
      setTestConnStatus(res.ok ? 'success' : 'failed');
    } catch {
      setTestConnStatus('failed');
    }
  }, [llmEndpoint, llmApiKey, llmModel]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label={t('设置')} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>{t('Workspace Settings')}</div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="settings-tabs">
          {(['providers', 'general', 'grammar', 'compile'] as const).map((tab) => (
            <button
              key={tab}
              className={`settings-tab ${settingsTab === tab ? 'active' : ''}`}
              onClick={() => setSettingsTab(tab)}
            >
              {t(`settings.tab.${tab}`)}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {/* ── Providers Tab ── */}
          {settingsTab === 'providers' && (
            <>
              <div className="field">
                <label>{t('provider.label')}</label>
                <div className="provider-cards">
                  {(Object.keys(PROVIDER_PRESETS) as LLMProvider[]).map((p) => (
                    <button
                      key={p}
                      className={`provider-card ${provider === p ? 'active' : ''}`}
                      onClick={() => handleProviderChange(p)}
                    >
                      {PROVIDER_PRESETS[p].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Endpoint</label>
                <input
                  className="input"
                  value={llmEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, llmEndpoint: e.target.value }))}
                  placeholder={PROVIDER_PRESETS[provider]?.endpoint || 'https://api.openai.com/v1'}
                />
              </div>
              <div className="field">
                <label>Model</label>
                {provider === 'ollama' && ollamaModels.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      className="input"
                      value={llmModel}
                      onChange={(e) => setSettings((prev) => ({ ...prev, llmModel: e.target.value }))}
                      style={{ flex: 1 }}
                    >
                      {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="btn ghost" onClick={() => {
                      ollamaListModels(llmEndpoint.replace(/\/v1$/, '')).then((res) => {
                        if (res.ok) setOllamaModels(res.models);
                      });
                    }}>{t('provider.refreshModels')}</button>
                  </div>
                ) : (
                  <input
                    className="input"
                    value={llmModel}
                    onChange={(e) => setSettings((prev) => ({ ...prev, llmModel: e.target.value }))}
                    placeholder={PROVIDER_PRESETS[provider]?.model || 'gpt-4o'}
                  />
                )}
              </div>
              {PROVIDER_PRESETS[provider]?.needsKey !== false && (
                <div className="field">
                  <label>API Key</label>
                  <input
                    className="input"
                    value={llmApiKey}
                    onChange={(e) => setSettings((prev) => ({ ...prev, llmApiKey: e.target.value }))}
                    placeholder="sk-..."
                    type="password"
                  />
                  {!llmApiKey && (
                    <div className="muted">{t('未配置 API Key 时将使用后端环境变量。')}</div>
                  )}
                </div>
              )}
              {provider === 'ollama' && (
                <div className="muted" style={{ marginTop: 4 }}>{t('provider.ollamaHint')}</div>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <button
                  className={`btn ${testConnStatus === 'success' ? 'ghost' : ''}`}
                  onClick={handleTestConnection}
                  disabled={testConnStatus === 'testing'}
                >
                  {testConnStatus === 'testing' ? t('provider.testing') :
                   testConnStatus === 'success' ? t('provider.success') :
                   t('provider.test')}
                </button>
              </div>
            </>
          )}

          {/* ── General Tab (Search / Vision overrides) ── */}
          {settingsTab === 'general' && (
            <>
              <div className="field">
                <label>{t('Search LLM Endpoint (可选)')}</label>
                <input
                  className="input"
                  value={searchEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchEndpoint: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
                <div className="muted">{t('仅用于"检索/websearch"任务，留空则复用 LLM Endpoint。')}</div>
              </div>
              <div className="field">
                <label>{t('Search LLM Model (可选)')}</label>
                <input
                  className="input"
                  value={searchModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchModel: e.target.value }))}
                  placeholder="claude-sonnet-4-5-20250929"
                />
              </div>
              <div className="field">
                <label>{t('Search LLM API Key (可选)')}</label>
                <input
                  className="input"
                  value={searchApiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchApiKey: e.target.value }))}
                  placeholder="sk-..."
                  type="password"
                />
              </div>
              <div className="field">
                <label>{t('VLM Endpoint (可选)')}</label>
                <input
                  className="input"
                  value={visionEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, visionEndpoint: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
                <div className="muted">{t('仅用于图像识别，留空则复用 LLM Endpoint。')}</div>
              </div>
              <div className="field">
                <label>{t('VLM Model (可选)')}</label>
                <input
                  className="input"
                  value={visionModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, visionModel: e.target.value }))}
                  placeholder="gpt-4o"
                />
              </div>
              <div className="field">
                <label>{t('VLM API Key (可选)')}</label>
                <input
                  className="input"
                  value={visionApiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, visionApiKey: e.target.value }))}
                  placeholder="sk-..."
                  type="password"
                />
              </div>
            </>
          )}

          {/* ── Grammar Tab ── */}
          {settingsTab === 'grammar' && (
            <>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={grammarEnabled}
                    onChange={(e) => setSettings((prev) => ({ ...prev, grammarEnabled: e.target.checked }))}
                  />
                  {t('grammar.enabled')}
                </label>
                <div className="muted">{t('grammar.enabledDesc')}</div>
              </div>
              <div className="field">
                <label>{t('grammar.model')}</label>
                <input
                  className="input"
                  value={grammarModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, grammarModel: e.target.value }))}
                  placeholder={llmModel || 'gpt-4o'}
                />
                <div className="muted">{t('grammar.modelHint')}</div>
              </div>
            </>
          )}

          {/* ── Compilation Tab ── */}
          {settingsTab === 'compile' && (
            <>
              <div className="field">
                <label>{t('编译引擎')}</label>
                <select
                  className="input"
                  value={compileEngine}
                  onChange={(e) => setSettings((prev) => ({ ...prev, compileEngine: e.target.value as CompileEngine }))}
                >
                  <option value="pdflatex">pdfLaTeX</option>
                  <option value="xelatex">XeLaTeX</option>
                  <option value="lualatex">LuaLaTeX</option>
                  <option value="latexmk">Latexmk</option>
                  <option value="tectonic">Tectonic</option>
                </select>
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{t('关闭')}</button>
          <button className="btn" onClick={onClose}>{t('完成')}</button>
        </div>
      </div>
    </div>
  );
}
