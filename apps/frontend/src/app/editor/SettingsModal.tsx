import { useCallback, useState } from 'react';
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
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label={'Settings'} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>{'Workspace Settings'}</div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="settings-tabs">
          {(['providers', 'general', 'grammar', 'compile'] as const).map((tab) => (
            <button
              key={tab}
              className={`settings-tab ${settingsTab === tab ? 'active' : ''}`}
              onClick={() => setSettingsTab(tab)}
            >
              {({ general: 'General', providers: 'Providers', grammar: 'Grammar', compile: 'Compilation' } as Record<string, string>)[tab] || tab}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {/* ── Providers Tab ── */}
          {settingsTab === 'providers' && (
            <>
              <div className="field">
                <label>{'LLM Provider'}</label>
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
                    }}>{'Refresh Models'}</button>
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
                    <div className="muted">{'If API Key is empty, backend env vars will be used.'}</div>
                  )}
                </div>
              )}
              {provider === 'ollama' && (
                <div className="muted" style={{ marginTop: 4 }}>{'No API key needed for local Ollama.'}</div>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <button
                  className={`btn ${testConnStatus === 'success' ? 'ghost' : ''}`}
                  onClick={handleTestConnection}
                  disabled={testConnStatus === 'testing'}
                >
                  {testConnStatus === 'testing' ? 'Testing...' :
                   testConnStatus === 'success' ? 'Connection successful!' :
                   'Test Connection'}
                </button>
              </div>
            </>
          )}

          {/* ── General Tab (Search / Vision overrides) ── */}
          {settingsTab === 'general' && (
            <>
              <div className="field">
                <label>{'Search LLM Endpoint (optional)'}</label>
                <input
                  className="input"
                  value={searchEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchEndpoint: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
                <div className="muted">{'Only for search/websearch tasks; empty means use LLM Endpoint.'}</div>
              </div>
              <div className="field">
                <label>{'Search LLM Model (optional)'}</label>
                <input
                  className="input"
                  value={searchModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchModel: e.target.value }))}
                  placeholder="claude-sonnet-4-5-20250929"
                />
              </div>
              <div className="field">
                <label>{'Search LLM API Key (optional)'}</label>
                <input
                  className="input"
                  value={searchApiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, searchApiKey: e.target.value }))}
                  placeholder="sk-..."
                  type="password"
                />
              </div>
              <div className="field">
                <label>{'VLM Endpoint (optional)'}</label>
                <input
                  className="input"
                  value={visionEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, visionEndpoint: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
                <div className="muted">{'Only for vision; empty means use LLM Endpoint.'}</div>
              </div>
              <div className="field">
                <label>{'VLM Model (optional)'}</label>
                <input
                  className="input"
                  value={visionModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, visionModel: e.target.value }))}
                  placeholder="gpt-4o"
                />
              </div>
              <div className="field">
                <label>{'VLM API Key (optional)'}</label>
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
                  {'Enable real-time grammar checking'}
                </label>
                <div className="muted">{'Underlines grammar, spelling, and style issues as you type. Uses API calls.'}</div>
              </div>
              <div className="field">
                <label>{'Grammar Check Model'}</label>
                <input
                  className="input"
                  value={grammarModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, grammarModel: e.target.value }))}
                  placeholder={llmModel || 'gpt-4o'}
                />
                <div className="muted">{'Model for grammar checks (can use a fast/cheap one). Leave empty to use main LLM model.'}</div>
              </div>
            </>
          )}

          {/* ── Compilation Tab ── */}
          {settingsTab === 'compile' && (
            <>
              <div className="field">
                <label>{'Compile Engine'}</label>
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
          <button className="btn ghost" onClick={onClose}>{'Close'}</button>
          <button className="btn" onClick={onClose}>{'Done'}</button>
        </div>
      </div>
    </div>
  );
}
