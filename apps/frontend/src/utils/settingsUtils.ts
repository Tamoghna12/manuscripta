export type CompileEngine = 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk' | 'tectonic';

export type LLMProvider = 'anthropic' | 'ollama' | 'zai' | 'openai' | 'custom';

export type AppSettings = {
  provider: LLMProvider;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  searchEndpoint: string;
  searchApiKey: string;
  searchModel: string;
  visionEndpoint: string;
  visionApiKey: string;
  visionModel: string;
  compileEngine: CompileEngine;
  grammarEnabled: boolean;
  grammarModel: string;
};

export const PROVIDER_PRESETS: Record<
  LLMProvider,
  { endpoint: string; model: string; needsKey: boolean; label: string }
> = {
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-5-20250929',
    needsKey: true,
    label: 'Anthropic (Claude)',
  },
  ollama: {
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3.3:latest',
    needsKey: false,
    label: 'Ollama (Local)',
  },
  zai: {
    endpoint: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.7',
    needsKey: true,
    label: 'Z.AI (GLM)',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsKey: true,
    label: 'OpenAI',
  },
  custom: { endpoint: '', model: '', needsKey: true, label: 'Custom' },
};

export const SETTINGS_KEY = 'manuscripta-settings-v1';

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmApiKey: '',
  llmModel: 'gpt-4o',
  searchEndpoint: '',
  searchApiKey: '',
  searchModel: '',
  visionEndpoint: '',
  visionApiKey: '',
  visionModel: '',
  compileEngine: 'pdflatex',
  grammarEnabled: false,
  grammarModel: '',
};

const VALID_ENGINES: CompileEngine[] = ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic'];

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const engine = parsed.compileEngine;
    const compileEngine: CompileEngine = VALID_ENGINES.includes(engine as CompileEngine)
      ? (engine as CompileEngine)
      : DEFAULT_SETTINGS.compileEngine;
    return { ...DEFAULT_SETTINGS, ...parsed, compileEngine };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

const COLLAB_NAME_KEY = 'manuscripta-collab-name';
const COLLAB_COLORS = [
  '#b44a2f',
  '#2f6fb4',
  '#2f9b74',
  '#b48a2f',
  '#6b2fb4',
  '#b42f6d',
  '#2f8fb4',
];

export function loadCollabName() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(COLLAB_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function persistCollabName(name: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAB_NAME_KEY, name);
  } catch {
    // ignore
  }
}

export function pickCollabColor(seed?: string) {
  if (!seed) {
    return COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
