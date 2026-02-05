import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from 'react';
import { basicSetup } from 'codemirror';
import { latex } from '../latex/lang';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, DecorationSet, WidgetType, keymap } from '@codemirror/view';
import { GlobalWorkerOptions, getDocument, renderTextLayer } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import {
  createProject,
  createFolder as createFolderApi,
  compileProject,
  deleteProject,
  getAllFiles,
  getFile,
  getProjectTree,
  listProjects,
  listTemplates,
  renameProject,
  convertTemplate,
  renamePath,
  runAgent,
  uploadFiles,
  writeFile
} from '../api/client';
import { createTwoFilesPatch, diffLines } from 'diff';
import { createLatexEngine, LatexEngine, CompileOutcome } from '../latex/engine';

GlobalWorkerOptions.workerSrc = pdfWorker;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface PendingChange {
  filePath: string;
  original: string;
  proposed: string;
  diff: string;
}

type InlineEdit =
  | { kind: 'new-file' | 'new-folder'; parent: string; value: string }
  | { kind: 'rename'; path: string; value: string };

type ProjectEdit =
  | { kind: 'new'; value: string }
  | { kind: 'rename'; id: string; value: string };

type CompileEngine = 'swiftlatex' | 'tectonic' | 'auto';

type AppSettings = {
  texliveEndpoint: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  compileEngine: CompileEngine;
};

const DEFAULT_TASKS = [
  { value: 'polish', label: '润色' },
  { value: 'rewrite', label: '改写' },
  { value: 'structure', label: '结构调整' },
  { value: 'translate', label: '翻译' },
  { value: 'custom', label: '自定义' }
];

const SETTINGS_KEY = 'openprism-settings-v1';
const DEFAULT_SETTINGS: AppSettings = {
  texliveEndpoint: 'https://texlive.swiftlatex.com',
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmApiKey: '',
  llmModel: 'gpt-4o-mini',
  compileEngine: 'swiftlatex'
};

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const engine = parsed.compileEngine;
    const compileEngine: CompileEngine =
      engine === 'swiftlatex' || engine === 'tectonic' || engine === 'auto'
        ? engine
        : DEFAULT_SETTINGS.compileEngine;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      compileEngine
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

const FIGURE_EXTS = ['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.eps'];
const TEXT_EXTS = ['.sty', '.cls', '.bst', '.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.tsv'];

function isFigureFile(path: string) {
  const lower = path.toLowerCase();
  return FIGURE_EXTS.some((ext) => lower.endsWith(ext));
}

function isTextFile(path: string) {
  const lower = path.toLowerCase();
  return lower.endsWith('.tex') || lower.endsWith('.bib') || TEXT_EXTS.some((ext) => lower.endsWith(ext));
}

function getParentPath(target: string) {
  if (!target) return '';
  const idx = target.lastIndexOf('/');
  return idx === -1 ? '' : target.slice(0, idx);
}

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: TreeNode[];
};

function buildTree(items: { path: string; type: string }[]) {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };
  const nodeMap = new Map<string, TreeNode>([['', root]]);

  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));

  sorted.forEach((item) => {
    const parts = item.path.split('/').filter(Boolean);
    let currentPath = '';
    parts.forEach((part, index) => {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      if (!nodeMap.has(nextPath)) {
        const isLeaf = index === parts.length - 1;
        const node: TreeNode = {
          name: part,
          path: nextPath,
          type: isLeaf ? (item.type === 'dir' ? 'dir' : 'file') : 'dir',
          children: []
        };
        const parent = nodeMap.get(currentPath);
        if (parent) {
          parent.children.push(node);
        }
        nodeMap.set(nextPath, node);
      }
      currentPath = nextPath;
    });
  });

  const sortNodes = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNodes);
  };

  sortNodes(root);
  return root;
}

const setGhostEffect = StateEffect.define<{ pos: number | null; text: string }>();

class GhostWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-ghost';
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const ghostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setGhostEffect)) {
        const { pos, text } = effect.value;
        if (pos == null || !text) {
          return Decoration.none;
        }
        const widget = Decoration.widget({
          widget: new GhostWidget(text),
          side: 1
        });
        return Decoration.set([widget.range(pos)]);
      }
    }
    if (tr.docChanged || tr.selectionSet) {
      return Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      background: 'transparent'
    },
    '.cm-scroller': {
      fontFamily: '"JetBrains Mono", "SF Mono", "Menlo", monospace',
      fontSize: '12px',
      lineHeight: '1.6'
    },
    '.cm-content': {
      padding: '16px'
    },
    '.cm-gutters': {
      background: 'transparent',
      border: 'none',
      color: 'rgba(122, 111, 103, 0.6)'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px'
    },
    '.cm-activeLine': {
      background: 'rgba(180, 74, 47, 0.08)'
    },
    '.cm-activeLineGutter': {
      background: 'transparent'
    },
    '.cm-selectionBackground': {
      background: 'rgba(180, 74, 47, 0.18)'
    }
  },
  { dark: false }
);

function buildSplitDiff(original: string, proposed: string) {
  const parts = diffLines(original, proposed);
  let leftLine = 1;
  let rightLine = 1;
  const rows: {
    left?: string;
    right?: string;
    leftNo?: number;
    rightNo?: number;
    type: 'context' | 'added' | 'removed';
  }[] = [];

  parts.forEach((part) => {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    lines.forEach((line) => {
      if (part.added) {
        rows.push({ right: line, rightNo: rightLine++, type: 'added' });
      } else if (part.removed) {
        rows.push({ left: line, leftNo: leftLine++, type: 'removed' });
      } else {
        rows.push({
          left: line,
          right: line,
          leftNo: leftLine++,
          rightNo: rightLine++,
          type: 'context'
        });
      }
    });
  });

  return rows;
}

type CompileError = {
  message: string;
  line?: number;
  file?: string;
  raw?: string;
};

function parseCompileErrors(log: string): CompileError[] {
  if (!log) return [];
  const lines = log.split('\n');
  const errors: CompileError[] = [];
  const seen = new Set<string>();

  const pushError = (error: CompileError) => {
    const key = `${error.file || ''}:${error.line || ''}:${error.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push(error);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fileLineMatch = line.match(/([A-Za-z0-9_./-]+\.tex):(\d+)/);
    if (fileLineMatch) {
      pushError({
        message: line.trim(),
        file: fileLineMatch[1],
        line: Number(fileLineMatch[2]),
        raw: line
      });
    }
    if (line.startsWith('!')) {
      const message = line.replace(/^!+\s*/, '').trim();
      let lineNo: number | undefined;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
        const match = lines[j].match(/l\.(\d+)/);
        if (match) {
          lineNo = Number(match[1]);
          break;
        }
      }
      pushError({ message, line: lineNo, raw: line });
    }
  }

  return errors;
}

function findLineOffset(text: string, line: number) {
  if (line <= 1) return 0;
  let offset = 0;
  let current = 1;
  while (current < line && offset < text.length) {
    const next = text.indexOf('\n', offset);
    if (next === -1) break;
    offset = next + 1;
    current += 1;
  }
  return offset;
}

function replaceSelection(source: string, start: number, end: number, replacement: string) {
  return source.slice(0, start) + replacement + source.slice(end);
}

function SplitDiffView({ rows }: { rows: ReturnType<typeof buildSplitDiff> }) {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const lockRef = useRef(false);

  const syncScroll = (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target || lockRef.current) return;
    lockRef.current = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      lockRef.current = false;
    });
  };

  return (
    <div className="split-diff">
      <div
        className="split-column"
        ref={leftRef}
        onScroll={() => syncScroll(leftRef.current, rightRef.current)}
      >
        <div className="split-header">Before</div>
        {rows.map((row, idx) => (
          <div key={`l-${idx}`} className={`split-row ${row.type}`}>
            <div className="line-no">{row.leftNo ?? ''}</div>
            <div className="line-text">{row.left ?? ''}</div>
          </div>
        ))}
      </div>
      <div
        className="split-column"
        ref={rightRef}
        onScroll={() => syncScroll(rightRef.current, leftRef.current)}
      >
        <div className="split-header">After</div>
        {rows.map((row, idx) => (
          <div key={`r-${idx}`} className={`split-row ${row.type}`}>
            <div className="line-no">{row.rightNo ?? ''}</div>
            <div className="line-text">{row.right ?? ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PdfPreview({
  pdfUrl,
  scale,
  fitWidth,
  onFitScale,
  onTextClick
}: {
  pdfUrl: string;
  scale: number;
  fitWidth: boolean;
  onFitScale?: (value: number | null) => void;
  onTextClick: (text: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfUrl) return;
    let cancelled = false;
    container.innerHTML = '';

    const render = async () => {
      try {
        const loadingTask = getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        // 获取容器宽度用于计算缩放比例
        const containerWidth = container.clientWidth - 24; // 减去 padding

        let baseScale = scale;
        let firstPage: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
        if (fitWidth && containerWidth > 0) {
          firstPage = await pdf.getPage(1);
          const originalViewport = firstPage.getViewport({ scale: 1.0 });
          baseScale = containerWidth / originalViewport.width;
          if (onFitScale) {
            onFitScale(baseScale);
          }
        } else if (onFitScale) {
          onFitScale(null);
        }

        const renderPage = async (page: Awaited<ReturnType<typeof pdf.getPage>>) => {
          // 先获取原始尺寸
          const cssViewport = page.getViewport({ scale: baseScale });
          const qualityBoost = Math.min(2.4, (window.devicePixelRatio || 1) * 1.25);
          const renderViewport = page.getViewport({ scale: baseScale * qualityBoost });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page';
          pageWrapper.style.width = `${cssViewport.width}px`;
          pageWrapper.style.height = `${cssViewport.height}px`;

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = renderViewport.width;
          canvas.height = renderViewport.height;
          canvas.style.width = `${cssViewport.width}px`;
          canvas.style.height = `${cssViewport.height}px`;
          pageWrapper.appendChild(canvas);

          const textLayer = document.createElement('div');
          textLayer.className = 'textLayer';
          textLayer.style.width = `${cssViewport.width}px`;
          textLayer.style.height = `${cssViewport.height}px`;
          pageWrapper.appendChild(textLayer);

          container.appendChild(pageWrapper);

          if (ctx) {
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
          }
          const textContent = await page.getTextContent();
          renderTextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport: cssViewport
          });
        };

        if (firstPage) {
          if (cancelled) return;
          await renderPage(firstPage);
        }

        for (let pageNum = firstPage ? 2 : 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          await renderPage(page);
        }
      } catch (err) {
        console.error('PDF render error:', err);
        container.innerHTML = '<div class="muted">PDF 渲染失败</div>';
      }
    };

    render().catch(() => {
      container.innerHTML = '<div class="muted">PDF 渲染失败</div>';
    });

    return () => {
      cancelled = true;
      container.innerHTML = '';
    };
  }, [pdfUrl, fitWidth, onFitScale, scale]);

  return (
    <div
      className="pdf-preview"
      ref={containerRef}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.tagName !== 'SPAN') return;
        const text = (target.textContent || '').trim();
        if (text.length < 3) return;
        onTextClick(text);
      }}
    />
  );
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState('');
  const [projectEdit, setProjectEdit] = useState<ProjectEdit | null>(null);
  const [tree, setTree] = useState<{ path: string; type: string }[]>([]);
  const [activePath, setActivePath] = useState<string>('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [editorValue, setEditorValue] = useState<string>('');
  const [selectionRange, setSelectionRange] = useState<[number, number]>([0, 0]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [inlineSuggestionText, setInlineSuggestionText] = useState('');
  const [suggestionPos, setSuggestionPos] = useState<{ left: number; top: number } | null>(null);
  const [assistantMode, setAssistantMode] = useState<'chat' | 'agent'>('agent');
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [agentMessages, setAgentMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState(DEFAULT_TASKS[0].value);
  const [mode, setMode] = useState<'direct' | 'tools'>('direct');
  const [translateScope, setTranslateScope] = useState<'selection' | 'file' | 'project'>('selection');
  const [translateTarget, setTranslateTarget] = useState('English');
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [compileLog, setCompileLog] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfFitWidth, setPdfFitWidth] = useState(true);
  const [pdfFitScale, setPdfFitScale] = useState<number | null>(null);
  const [engineName, setEngineName] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [rightView, setRightView] = useState<'pdf' | 'figures' | 'diff'>('pdf');
  const [selectedFigure, setSelectedFigure] = useState<string>('');
  const [diffFocus, setDiffFocus] = useState<PendingChange | null>(null);
  const [activeSidebar, setActiveSidebar] = useState<'projects' | 'files' | 'agent'>('projects');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [columnSizes, setColumnSizes] = useState({ sidebar: 260, editor: 640, right: 420 });
  const [editorSplit, setEditorSplit] = useState(0.7);
  const [selectedPath, setSelectedPath] = useState('');
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [dragOverPath, setDragOverPath] = useState('');
  const [mainFile, setMainFile] = useState('main.tex');
  const [fileFilter, setFileFilter] = useState('');
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [templates, setTemplates] = useState<{ id: string; label: string; mainFile: string }[]>([]);
  const [targetTemplate, setTargetTemplate] = useState('');
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const activePathRef = useRef<string>('');
  const inlineSuggestionRef = useRef<string>('');
  const inlineAnchorRef = useRef<number | null>(null);
  const applyingSuggestionRef = useRef(false);
  const typewriterTimerRef = useRef<number | null>(null);
  const requestSuggestionRef = useRef<() => void>(() => {});
  const acceptSuggestionRef = useRef<() => void>(() => {});
  const acceptChunkRef = useRef<() => void>(() => {});
  const clearSuggestionRef = useRef<() => void>(() => {});
  const engineRef = useRef<LatexEngine | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const { texliveEndpoint, llmEndpoint, llmApiKey, llmModel, compileEngine } = settings;

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  useEffect(() => {
    engineRef.current = null;
    setEngineName('');
  }, [texliveEndpoint]);

  const llmConfig = useMemo(
    () => ({
      endpoint: llmEndpoint,
      apiKey: llmApiKey || undefined,
      model: llmModel
    }),
    [llmEndpoint, llmApiKey, llmModel]
  );

  const loadProjects = useCallback(async (selectId?: string) => {
    const data = await listProjects();
    if (data.projects.length === 0) {
      const created = await createProject({ name: 'OpenPrism ACL', template: 'acl' });
      setProjects([created]);
      setProjectId(created.id);
      return;
    }
    setProjects(data.projects);
    if (selectId && data.projects.find((p) => p.id === selectId)) {
      setProjectId(selectId);
      return;
    }
    setProjectId(data.projects[0].id);
  }, []);

  useEffect(() => {
    loadProjects().catch((err) => {
      setStatus(`初始化失败: ${String(err)}`);
    });
  }, [loadProjects]);

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await listTemplates();
        setTemplates(res.templates || []);
        if (res.templates?.length) {
          setTargetTemplate((prev) => prev || res.templates[0].id);
        }
      } catch (err) {
        setStatus(`模板加载失败: ${String(err)}`);
      }
    };
    loadTemplates();
  }, []);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  const refreshTree = async (keepActive = true) => {
    if (!projectId) return;
    const res = await getProjectTree(projectId);
    setTree(res.items);
    if (!keepActive || !activePath || !res.items.find((item) => item.path === activePath)) {
      const main = res.items.find((item) => item.path.endsWith('main.tex'))?.path;
      const next = main || res.items.find((item) => item.type === 'file')?.path || '';
      if (next) {
        await openFile(next);
      }
    }
  };

  useEffect(() => {
    if (!projectId) return;
    setFiles({});
    setActivePath('');
    refreshTree(false).catch((err) => setStatus(`加载文件树失败: ${String(err)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filteredProjects = useMemo(() => {
    const term = projectFilter.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((item) => item.name.toLowerCase().includes(term));
  }, [projects, projectFilter]);

  const beginProjectCreate = () => {
    setProjectEdit({ kind: 'new', value: '' });
  };

  const beginProjectRename = () => {
    const current = projects.find((item) => item.id === projectId);
    if (!current) return;
    setProjectEdit({ kind: 'rename', id: current.id, value: current.name });
  };

  const confirmProjectEdit = async () => {
    if (!projectEdit) return;
    const name = projectEdit.value.trim();
    if (!name) {
      setProjectEdit(null);
      return;
    }
    if (projectEdit.kind === 'new') {
      const created = await createProject({ name, template: targetTemplate || 'acl' });
      await loadProjects(created.id);
    } else {
      await renameProject(projectEdit.id, name);
      await loadProjects(projectEdit.id);
    }
    setProjectEdit(null);
  };

  const cancelProjectEdit = () => setProjectEdit(null);

  const removeProject = async () => {
    if (!projectId) return;
    const current = projects.find((item) => item.id === projectId);
    if (!current) return;
    if (!window.confirm(`删除项目 ${current.name}？此操作不可撤销。`)) return;
    await deleteProject(projectId);
    await loadProjects();
  };

  useEffect(() => {
    if (!editorHostRef.current || cmViewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      const skipClear = applyingSuggestionRef.current;
      if (update.docChanged) {
        const value = update.state.doc.toString();
        setEditorValue(value);
        const path = activePathRef.current;
        if (path) {
          setFiles((prev) => ({ ...prev, [path]: value }));
        }
      }
      if (update.selectionSet) {
        const sel = update.state.selection.main;
        setSelectionRange([sel.from, sel.to]);
      }
      if (!skipClear && inlineSuggestionRef.current && (update.docChanged || update.selectionSet)) {
        inlineSuggestionRef.current = '';
        inlineAnchorRef.current = null;
        setInlineSuggestionText('');
        setTimeout(() => {
          const view = cmViewRef.current;
          if (view) {
            view.dispatch({ effects: setGhostEffect.of({ pos: null, text: '' }) });
          }
        }, 0);
      }
      if (skipClear) {
        applyingSuggestionRef.current = false;
      }
    });

    const keymapExtension = keymap.of([
      {
        key: 'Alt-/',
        run: () => {
          requestSuggestionRef.current();
          return true;
        }
      },
      {
        key: 'Mod-Space',
        run: () => {
          requestSuggestionRef.current();
          return true;
        }
      },
      {
        key: 'ArrowRight',
        run: (view) => {
          const pos = view.state.selection.main.head;
          if (inlineSuggestionRef.current && inlineAnchorRef.current === pos) {
            acceptChunkRef.current();
            return true;
          }
          return false;
        }
      },
      {
        key: 'Tab',
        run: () => {
          if (!inlineSuggestionRef.current) return false;
          acceptSuggestionRef.current();
          return true;
        }
      },
      {
        key: 'Escape',
        run: () => {
          clearSuggestionRef.current();
          return true;
        }
      }
    ]);

    const state = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        latex(),
        EditorView.lineWrapping,
        editorTheme,
        ghostField,
        updateListener,
        keymapExtension
      ]
    });

    const view = new EditorView({
      state,
      parent: editorHostRef.current
    });
    cmViewRef.current = view;

    const handleAltSlash = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === '/' || event.key === '÷' || event.code === 'Slash') {
        event.preventDefault();
        event.stopPropagation();
        requestSuggestionRef.current();
      }
    };
    view.dom.addEventListener('keydown', handleAltSlash, true);

    return () => {
      view.dom.removeEventListener('keydown', handleAltSlash, true);
      view.destroy();
      cmViewRef.current = null;
    };
  }, []);

  const openFile = async (filePath: string) => {
    setActivePath(filePath);
    activePathRef.current = filePath;
    setSelectedPath(filePath);
    if (filePath.includes('/')) {
      const parts = filePath.split('/').slice(0, -1);
      setOpenFolders((prev) => {
        const next = { ...prev };
        let current = '';
        parts.forEach((part) => {
          current = current ? `${current}/${part}` : part;
          next[current] = true;
        });
        return next;
      });
    }
    if (Object.prototype.hasOwnProperty.call(files, filePath)) {
      const cached = files[filePath] ?? '';
      setEditorValue(cached);
      setEditorDoc(cached);
      return cached;
    }
    const data = await getFile(projectId, filePath);
    setFiles((prev) => ({ ...prev, [filePath]: data.content }));
    setEditorValue(data.content);
    setEditorDoc(data.content);
    return data.content;
  };

  const setEditorDoc = useCallback((value: string) => {
    const view = cmViewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    });
  }, []);

  const clearInlineSuggestion = useCallback(() => {
    inlineSuggestionRef.current = '';
    inlineAnchorRef.current = null;
    setInlineSuggestionText('');
    setSuggestionPos(null);
    const view = cmViewRef.current;
    if (view) {
      view.dispatch({ effects: setGhostEffect.of({ pos: null, text: '' }) });
    }
  }, []);

  const nextSuggestionChunk = (text: string) => {
    const match = text.match(/^(\s*\S+\s*)/);
    return match ? match[1] : text;
  };

  const acceptInlineSuggestion = useCallback(() => {
    const view = cmViewRef.current;
    const text = inlineSuggestionRef.current;
    const pos = inlineAnchorRef.current;
    if (!view || !text || pos == null) return;
    applyingSuggestionRef.current = true;
    view.dispatch({
      changes: { from: pos, to: pos, insert: text },
      selection: { anchor: pos + text.length }
    });
    clearInlineSuggestion();
  }, [clearInlineSuggestion]);

  const acceptSuggestionChunk = useCallback(() => {
    const view = cmViewRef.current;
    const remaining = inlineSuggestionRef.current;
    const pos = inlineAnchorRef.current;
    if (!view || !remaining || pos == null) return;
    const chunk = nextSuggestionChunk(remaining);
    applyingSuggestionRef.current = true;
    view.dispatch({
      changes: { from: pos, to: pos, insert: chunk },
      selection: { anchor: pos + chunk.length }
    });
    const leftover = remaining.slice(chunk.length);
    if (!leftover) {
      clearInlineSuggestion();
      return;
    }
    inlineSuggestionRef.current = leftover;
    inlineAnchorRef.current = pos + chunk.length;
    setInlineSuggestionText(leftover);
    view.dispatch({ effects: setGhostEffect.of({ pos: pos + chunk.length, text: leftover }) });
  }, [clearInlineSuggestion]);

  const updateSuggestionPosition = useCallback((force = false) => {
    const view = cmViewRef.current;
    const anchor = inlineAnchorRef.current;
    const host = editorAreaRef.current;
    if (!view || !host || (!inlineSuggestionRef.current && !force) || anchor == null) {
      setSuggestionPos(null);
      return;
    }
    const coords = view.coordsAtPos(anchor);
    if (!coords) {
      setSuggestionPos(null);
      return;
    }
    const rect = host.getBoundingClientRect();
    const preferredLeft = coords.left - rect.left;
    const preferredTop = coords.bottom - rect.top + 6;
    const popoverWidth = 320;
    const clampedLeft = Math.min(Math.max(12, preferredLeft), Math.max(12, rect.width - popoverWidth));
    let top = preferredTop;
    if (preferredTop + 80 > rect.height) {
      top = Math.max(12, coords.top - rect.top - 62);
    }
    setSuggestionPos({ left: clampedLeft, top });
  }, []);

  const requestInlineSuggestion = useCallback(async () => {
    const view = cmViewRef.current;
    if (!view || isSuggesting) return;
    clearInlineSuggestion();
    const pos = view.state.selection.main.head;
    const docText = view.state.doc.toString();
    const before = docText.slice(Math.max(0, pos - 800), pos);
    const after = docText.slice(pos, pos + 200);
    inlineAnchorRef.current = pos;
    setIsSuggesting(true);
    updateSuggestionPosition(true);
    try {
      const res = await runAgent({
        task: 'autocomplete',
        prompt: 'Continue after the cursor. Return only the continuation text.',
        selection: '',
        content: `${before}<CURSOR>${after}`,
        mode: 'direct',
        projectId,
        activePath,
        compileLog,
        llmConfig
      });
      const suggestion = (res.suggestion || res.reply || '').trim();
      if (!suggestion) return;
      inlineSuggestionRef.current = suggestion;
      inlineAnchorRef.current = pos;
      setInlineSuggestionText(suggestion);
      view.dispatch({
        effects: setGhostEffect.of({ pos, text: suggestion })
      });
    } catch (err) {
      setStatus(`补全失败: ${String(err)}`);
    } finally {
      setIsSuggesting(false);
      if (!inlineSuggestionRef.current) {
        setSuggestionPos(null);
      }
    }
  }, [activePath, clearInlineSuggestion, compileLog, isSuggesting, llmConfig, projectId, updateSuggestionPosition]);

  useEffect(() => {
    if (!inlineSuggestionText) {
      setSuggestionPos(null);
      return;
    }
    updateSuggestionPosition();
  }, [inlineSuggestionText, updateSuggestionPosition]);

  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    const handleScroll = () => {
      if (inlineSuggestionRef.current) {
        updateSuggestionPosition();
      }
    };
    view.scrollDOM.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);
    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [updateSuggestionPosition]);

  useEffect(() => {
    if (!inlineSuggestionRef.current) return;
    updateSuggestionPosition();
  }, [columnSizes, editorSplit, updateSuggestionPosition]);

  useEffect(() => {
    requestSuggestionRef.current = requestInlineSuggestion;
    acceptSuggestionRef.current = acceptInlineSuggestion;
    acceptChunkRef.current = acceptSuggestionChunk;
    clearSuggestionRef.current = clearInlineSuggestion;
  }, [requestInlineSuggestion, acceptInlineSuggestion, acceptSuggestionChunk, clearInlineSuggestion]);

  useEffect(() => {
    if (!cmViewRef.current) return;
    setEditorDoc(editorValue);
  }, [editorValue, setEditorDoc]);

  const saveActiveFile = async () => {
    if (!activePath) return;
    await writeFile(projectId, activePath, editorValue);
    setStatus(`已保存 ${activePath}`);
  };

  const createBibFile = async () => {
    if (!projectId) return;
    const parent = selectedPath && tree.find((item) => item.path === selectedPath && item.type === 'dir')
      ? selectedPath
      : getParentPath(selectedPath || activePath || '');
    const path = parent ? `${parent}/references.bib` : 'references.bib';
    const content = '% Add BibTeX entries here\n';
    await writeFile(projectId, path, content);
    await refreshTree();
    await openFile(path);
  };

  const insertAtCursor = (text: string) => {
    if (!activePath) return;
    const view = cmViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length }
    });
  };

  const insertFigureSnippet = (filePath: string) => {
    const snippet = [
      '\\\\begin{figure}[t]',
      '\\\\centering',
      `\\\\includegraphics[width=0.9\\\\linewidth]{${filePath}}`,
      '\\\\caption{Caption.}',
      `\\\\label{fig:${filePath.replace(/[^a-zA-Z0-9]+/g, '-')}}`,
      '\\\\end{figure}',
      ''
    ].join('\\n');
    insertAtCursor(snippet);
  };

  const handleUpload = async (fileList: FileList | null, basePath = '') => {
    if (!projectId || !fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    await uploadFiles(projectId, files, basePath);
    await refreshTree();
  };

  const beginInlineCreate = (kind: 'new-file' | 'new-folder') => {
    if (!projectId) return;
    const selectedIsDir = selectedPath && tree.find((item) => item.path === selectedPath && item.type === 'dir');
    const parent = selectedIsDir ? selectedPath : getParentPath(selectedPath || activePath || '');
    setInlineEdit({ kind, parent, value: '' });
    if (parent) {
      setOpenFolders((prev) => ({ ...prev, [parent]: true }));
    }
  };

  const beginInlineRename = () => {
    if (!projectId) return;
    const target = selectedPath || activePath;
    if (!target) return;
    const name = target.split('/').pop() || target;
    setInlineEdit({ kind: 'rename', path: target, value: name });
  };

  const confirmInlineEdit = async () => {
    if (!projectId || !inlineEdit) return;
    const value = inlineEdit.value.trim();
    if (!value) {
      setInlineEdit(null);
      return;
    }
    if (inlineEdit.kind === 'rename') {
      const from = inlineEdit.path;
      const parent = getParentPath(from);
      const to = parent ? `${parent}/${value}` : value;
      await renamePath(projectId, from, to);
      if (activePath === from) {
        setActivePath(to);
        activePathRef.current = to;
      }
      setSelectedPath(to);
      await refreshTree();
      setInlineEdit(null);
      return;
    }

    const parent = inlineEdit.parent;
    const target = parent ? `${parent}/${value}` : value;
    if (inlineEdit.kind === 'new-folder') {
      await createFolderApi(projectId, target);
    } else {
      await writeFile(projectId, target, '');
      if (isTextFile(target)) {
        await openFile(target);
      }
    }
    await refreshTree();
    setInlineEdit(null);
  };

  const cancelInlineEdit = () => setInlineEdit(null);

  const moveFileToFolder = async (fromPath: string, folderPath: string) => {
    if (!projectId || !fromPath) return;
    const fileName = fromPath.split('/').pop();
    if (!fileName) return;
    const target = folderPath ? `${folderPath}/${fileName}` : fileName;
    if (target === fromPath) return;
    await renamePath(projectId, fromPath, target);
    if (activePath === fromPath) {
      setActivePath(target);
      activePathRef.current = target;
    }
    setSelectedPath(target);
    await refreshTree();
  };

  const filteredTreeItems = useMemo(() => {
    const term = fileFilter.trim().toLowerCase();
    if (!term) return tree;
    return tree.filter((item) => item.path.toLowerCase().includes(term));
  }, [tree, fileFilter]);

  const treeRoot = useMemo(() => buildTree(filteredTreeItems), [filteredTreeItems]);

  const texFiles = useMemo(
    () => tree.filter((item) => item.type === 'file' && item.path.toLowerCase().endsWith('.tex')).map((item) => item.path),
    [tree]
  );

  useEffect(() => {
    if (texFiles.length === 0) return;
    if (!texFiles.includes(mainFile)) {
      const preferred = texFiles.find((path) => path.endsWith('main.tex')) || texFiles[0];
      setMainFile(preferred);
    }
  }, [texFiles, mainFile]);

  const setAllFolders = useCallback(
    (open: boolean) => {
      const next: Record<string, boolean> = {};
      const walk = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (node.type === 'dir') {
            next[node.path] = open;
            walk(node.children);
          }
        });
      };
      walk(treeRoot.children);
      setOpenFolders(next);
    },
    [treeRoot]
  );

  const toggleFolder = (path: string) => {
    setOpenFolders((prev) => ({ ...prev, [path]: !prev[path] }));
    setSelectedPath(path);
  };

  const handleFileSelect = async (path: string) => {
    setSelectedPath(path);
    if (isFigureFile(path)) {
      setSelectedFigure(path);
      setRightView('figures');
      return;
    }
    if (!isTextFile(path)) {
      setStatus('该文件为二进制文件，暂不支持直接编辑。');
      return;
    }
    await openFile(path);
  };

  const inlineInputRow = (depth: number) => {
    if (!inlineEdit) return null;
    const paddingLeft = 8 + depth * 14;
    const isFolder = inlineEdit.kind === 'new-folder';
    return (
      <div className="tree-node">
        <div className={`tree-row ${isFolder ? 'folder' : 'file'} inline`} style={{ paddingLeft: paddingLeft + 14 }}>
          <input
            className="inline-input"
            autoFocus
            value={inlineEdit.value}
            onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                confirmInlineEdit().catch((err) => setStatus(`操作失败: ${String(err)}`));
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelInlineEdit();
              }
            }}
            onBlur={() => cancelInlineEdit()}
            placeholder={isFolder ? '新建文件夹' : '新建文件'}
          />
        </div>
      </div>
    );
  };

  const jumpToError = async (error: CompileError) => {
    const view = cmViewRef.current;
    const targetFile = error.file && isTextFile(error.file) ? error.file : activePath;
    if (!targetFile) return;
    let content = '';
    try {
      content = targetFile === activePath ? editorValue : await openFile(targetFile);
    } catch {
      return;
    }
    if (!content || !view) return;
    if (error.line) {
      const offset = findLineOffset(content, error.line);
      view.dispatch({
        selection: { anchor: offset, head: offset },
        scrollIntoView: true
      });
      view.focus();
    }
  };

  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      const isDir = node.type === 'dir';
      const isOpen = openFolders[node.path] ?? depth < 1;
      const isActive = activePath === node.path;
      const isSelected = selectedPath === node.path;
      const isDragOver = dragOverPath === node.path;
      const paddingLeft = 8 + depth * 14;

      if (isDir) {
        return (
          <div key={node.path} className="tree-node">
            <button
              className={`tree-row folder ${isOpen ? 'open' : ''} ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
              style={{ paddingLeft }}
              onClick={() => toggleFolder(node.path)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverPath(node.path);
              }}
              onDragLeave={() => setDragOverPath('')}
              onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                  handleUpload(event.dataTransfer.files, node.path).catch((err) => setStatus(`上传失败: ${String(err)}`));
                  setDragOverPath('');
                  return;
                }
                const from = event.dataTransfer.getData('text/plain');
                setDragOverPath('');
                if (from) {
                  moveFileToFolder(from, node.path);
                }
              }}
            >
              <span className="tree-caret">{isOpen ? '▾' : '▸'}</span>
              {inlineEdit?.kind === 'rename' && inlineEdit.path === node.path ? (
                <input
                  className="inline-input"
                  autoFocus
                  value={inlineEdit.value}
                  onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      confirmInlineEdit().catch((err) => setStatus(`操作失败: ${String(err)}`));
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelInlineEdit();
                    }
                  }}
                  onBlur={() => cancelInlineEdit()}
                />
              ) : (
                <span className="tree-label">{node.name}</span>
              )}
            </button>
            {isOpen && (
              <div className="tree-children">
                {renderTree(node.children, depth + 1)}
                {inlineEdit && inlineEdit.kind !== 'rename' && inlineEdit.parent === node.path && inlineInputRow(depth + 1)}
              </div>
            )}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          className={`tree-row file ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: paddingLeft + 14 }}
          onClick={() => handleFileSelect(node.path)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', node.path);
          }}
        >
          {inlineEdit?.kind === 'rename' && inlineEdit.path === node.path ? (
            <input
              className="inline-input"
              autoFocus
              value={inlineEdit.value}
              onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirmInlineEdit().catch((err) => setStatus(`操作失败: ${String(err)}`));
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelInlineEdit();
                }
              }}
              onBlur={() => cancelInlineEdit()}
            />
          ) : (
            <span className="tree-label">{node.name}</span>
          )}
          {isFigureFile(node.path) && <span className="tree-tag">FIG</span>}
          {node.path.endsWith('.bib') && <span className="tree-tag">BIB</span>}
        </button>
      );
    });

  const compile = async () => {
    if (!projectId) return;
    setIsCompiling(true);
    setStatus('编译中...');
    try {
      const { files: serverFiles } = await getAllFiles(projectId);
      const fileMap: Record<string, string | Uint8Array> = {};
      for (const file of serverFiles) {
        if (file.encoding === 'base64') {
          const binary = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
          fileMap[file.path] = binary;
        } else {
          fileMap[file.path] = files[file.path] ?? file.content;
        }
      }
      if (!fileMap[mainFile]) {
        throw new Error(`主文件不存在: ${mainFile}`);
      }
      const compileWithSwift = async () => {
        const engine = engineRef.current || await createLatexEngine(texliveEndpoint);
        engineRef.current = engine;
        setEngineName(engine.name);
        const result = await engine.compile(fileMap, mainFile);
        if (!result.pdf || result.pdf.length === 0) {
          throw new Error(`编译未生成 PDF 文件 (status: ${result.status})`);
        }
        return result;
      };

      const compileWithBackend = async () => {
        const res = await compileProject({ projectId, mainFile, engine: 'tectonic' });
        if (!res.ok || !res.pdf) {
          const detail = [res.error, res.log].filter(Boolean).join('\n');
          throw new Error(detail || '后端编译失败');
        }
        const binary = Uint8Array.from(atob(res.pdf), (c) => c.charCodeAt(0));
        return {
          pdf: binary,
          log: res.log || '',
          status: res.status ?? 0,
          engine: 'tectonic' as const
        };
      };

      let result: CompileOutcome;
      if (compileEngine === 'tectonic') {
        result = await compileWithBackend();
      } else if (compileEngine === 'swiftlatex') {
        result = await compileWithSwift();
      } else {
        try {
          result = await compileWithSwift();
        } catch (err) {
          setStatus('SwiftLaTeX 失败，尝试 Tectonic...');
          result = await compileWithBackend();
        }
      }

      const meta = [
        `Engine: ${result.engine}`,
        `Main file: ${mainFile}`,
        result.engine === 'swiftlatex' ? `TexLive: ${texliveEndpoint}` : ''
      ].filter(Boolean).join('\n');
      setEngineName(result.engine);
      setCompileLog(`${meta}\n\n${result.log || 'No log'}`.trim());

      const blob = new Blob([result.pdf], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(nextUrl);
      setRightView('pdf');
      setStatus(`编译完成 (${result.engine})`);
    } catch (err) {
      console.error('Compilation error:', err);
      setCompileLog(`编译错误: ${String(err)}\n${(err as Error).stack || ''}`);
      setStatus(`编译失败: ${String(err)}`);
    } finally {
      setIsCompiling(false);
    }
  };

  const selectionText = useMemo(() => {
    const [start, end] = selectionRange;
    if (start === end) return '';
    return editorValue.slice(start, end);
  }, [selectionRange, editorValue]);

  const compileErrors = useMemo(() => parseCompileErrors(compileLog), [compileLog]);
  const pendingGrouped = useMemo(() => {
    const map = new Map<string, PendingChange>();
    pendingChanges.forEach((item) => {
      map.set(item.filePath, item);
    });
    return Array.from(map.values());
  }, [pendingChanges]);

  const figureFiles = useMemo(
    () =>
      tree.filter(
        (item) =>
          item.type === 'file' &&
          FIGURE_EXTS.some((ext) => item.path.toLowerCase().endsWith(ext))
      ),
    [tree]
  );

  useEffect(() => {
    if (!selectedFigure && figureFiles.length > 0) {
      setSelectedFigure(figureFiles[0].path);
    }
  }, [figureFiles, selectedFigure]);

  const pdfScaleLabel = useMemo(() => {
    if (pdfFitWidth) {
      const fitValue = pdfFitScale ?? pdfScale;
      return `Fit · ${Math.round(fitValue * 100)}%`;
    }
    return `${Math.round(pdfScale * 100)}%`;
  }, [pdfFitScale, pdfFitWidth, pdfScale]);

  const clampPdfScale = useCallback((value: number) => Math.min(2.5, Math.max(0.6, value)), []);

  const zoomPdf = useCallback(
    (delta: number) => {
      const base = pdfFitScale ?? pdfScale;
      setPdfFitWidth(false);
      setPdfScale(clampPdfScale(base + delta));
    },
    [clampPdfScale, pdfFitScale, pdfScale]
  );

  const downloadPdf = useCallback(() => {
    if (!pdfUrl) return;
    const currentProject = projects.find((item) => item.id === projectId);
    const name = currentProject?.name ? currentProject.name.replace(/\s+/g, '-') : projectId || 'openprism';
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `${name}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [pdfUrl, projectId, projects]);

  const handleFitScale = useCallback((value: number | null) => {
    if (value == null) {
      setPdfFitScale(null);
      return;
    }
    setPdfFitScale((prev) => (prev && Math.abs(prev - value) < 0.005 ? prev : value));
  }, []);

  const startTypewriter = useCallback((setHistory: Dispatch<SetStateAction<Message[]>>, text: string) => {
    if (typewriterTimerRef.current) {
      window.clearTimeout(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (!text) {
      setHistory((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last.role === 'assistant') {
          next[next.length - 1] = { ...last, content: '' };
        }
        return next;
      });
      return;
    }
    let idx = 0;
    const step = () => {
      idx = Math.min(text.length, idx + 2);
      const slice = text.slice(0, idx);
      setHistory((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last.role !== 'assistant') return prev;
        next[next.length - 1] = { ...last, content: slice };
        return next;
      });
      if (idx < text.length) {
        typewriterTimerRef.current = window.setTimeout(step, 16);
      }
    };
    step();
  }, []);

  useEffect(() => {
    return () => {
      if (typewriterTimerRef.current) {
        window.clearTimeout(typewriterTimerRef.current);
      }
    };
  }, []);

  const sendPrompt = async () => {
    const isChat = assistantMode === 'chat';
    if (!activePath && !isChat) return;
    if (isChat === false && task === 'translate') {
      if (translateScope === 'selection' && !selectionText) {
        setStatus('请选择要翻译的文本。');
        return;
      }
    }
    const userMsg: Message = { role: 'user', content: prompt || '(empty)' };
    const setHistory = isChat ? setChatMessages : setAgentMessages;
    const history = isChat ? chatMessages : agentMessages;
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    try {
      let effectivePrompt = prompt;
      let effectiveSelection = selectionText;
      let effectiveContent = editorValue;
      let effectiveMode = mode;
      let effectiveTask = task;

      if (!isChat && task === 'translate') {
        const note = prompt ? `\nUser note: ${prompt}` : '';
        if (translateScope === 'project') {
          effectiveMode = 'tools';
          effectiveSelection = '';
          effectiveContent = '';
          effectivePrompt = `Translate all .tex files in the project to ${translateTarget}. Preserve LaTeX commands and structure.${note}`;
        } else if (translateScope === 'file') {
          effectiveSelection = '';
          effectivePrompt = `Translate the current file to ${translateTarget}. Preserve LaTeX commands and structure.${note}`;
        } else {
          effectivePrompt = `Translate the selected text to ${translateTarget}. Preserve LaTeX commands and structure.${note}`;
        }
        effectiveTask = 'translate';
      }

      const res = await runAgent({
        task: effectiveTask,
        prompt: effectivePrompt,
        selection: effectiveSelection,
        content: effectiveContent,
        mode: isChat ? 'direct' : effectiveMode,
        projectId,
        activePath,
        compileLog,
        llmConfig,
        interaction: isChat ? 'chat' : 'agent',
        history: nextHistory.slice(-8)
      });
      const replyText = res.reply || '已生成建议。';
      setHistory((prev) => [...prev, { role: 'assistant', content: '' }]);
      window.setTimeout(() => startTypewriter(setHistory, replyText), 0);

      if (!isChat && res.patches && res.patches.length > 0) {
        const nextPending = res.patches.map((patch) => ({
          filePath: patch.path,
          original: files[patch.path] ?? '',
          proposed: patch.content,
          diff: patch.diff
        }));
        setPendingChanges(nextPending);
        setRightView('diff');
      } else if (!isChat && res.suggestion) {
        const proposed = selectionText
          ? replaceSelection(editorValue, selectionRange[0], selectionRange[1], res.suggestion)
          : res.suggestion;
        const diff = createTwoFilesPatch(activePath, activePath, editorValue, proposed, 'current', 'suggested');
        setPendingChanges([{ filePath: activePath, original: editorValue, proposed, diff }]);
        setRightView('diff');
      }
    } catch (err) {
      setHistory((prev) => [...prev, { role: 'assistant', content: `请求失败: ${String(err)}` }]);
    }
  };

  const diagnoseCompile = async () => {
    if (!compileLog) {
      setStatus('暂无编译日志可诊断。');
      return;
    }
    if (!activePath) return;
    const userMsg: Message = { role: 'user', content: '诊断并修复编译错误' };
    const nextHistory = [...agentMessages, userMsg];
    setAgentMessages(nextHistory);
    try {
      const res = await runAgent({
        task: 'debug_compile',
        prompt: '基于编译日志诊断并修复错误，给出可应用的 diff。',
        selection: compileLog,
        content: editorValue,
        mode: 'tools',
        projectId,
        activePath,
        compileLog,
        llmConfig,
        interaction: 'agent',
        history: nextHistory.slice(-8)
      });
      const assistant: Message = {
        role: 'assistant',
        content: res.reply || '已生成编译修复建议。'
      };
      setAgentMessages((prev) => [...prev, assistant]);
      if (res.patches && res.patches.length > 0) {
        const nextPending = res.patches.map((patch) => ({
          filePath: patch.path,
          original: files[patch.path] ?? '',
          proposed: patch.content,
          diff: patch.diff
        }));
        setPendingChanges(nextPending);
        setRightView('diff');
      }
    } catch (err) {
      setAgentMessages((prev) => [...prev, { role: 'assistant', content: `请求失败: ${String(err)}` }]);
    }
  };

  const applyPending = async (change?: PendingChange) => {
    const list = change ? [change] : pendingChanges;
    for (const item of list) {
      await writeFile(projectId, item.filePath, item.proposed);
      setFiles((prev) => ({ ...prev, [item.filePath]: item.proposed }));
      if (activePath === item.filePath) {
        setEditorDoc(item.proposed);
      }
    }
    if (change) {
      setPendingChanges((prev) => prev.filter((item) => item.filePath !== change.filePath));
      if (diffFocus?.filePath === change.filePath) {
        setDiffFocus(null);
      }
    } else {
      setPendingChanges([]);
      setDiffFocus(null);
    }
    setStatus('已应用修改');
  };

  const discardPending = (change?: PendingChange) => {
    if (change) {
      setPendingChanges((prev) => prev.filter((item) => item.filePath !== change.filePath));
      if (diffFocus?.filePath === change.filePath) {
        setDiffFocus(null);
      }
    } else {
      setPendingChanges([]);
      setDiffFocus(null);
    }
  };

  const startColumnDrag = useCallback(
    (side: 'left' | 'right', event: MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const { sidebar, editor, right } = columnSizes;
      const minSidebar = 220;
      const minEditor = 360;
      const minRight = 320;

      const onMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        if (side === 'left') {
          const nextSidebar = Math.max(minSidebar, sidebar + dx);
          const nextEditor = Math.max(minEditor, editor - dx);
          setColumnSizes({ sidebar: nextSidebar, editor: nextEditor, right });
        } else {
          const nextEditor = Math.max(minEditor, editor + dx);
          const nextRight = Math.max(minRight, right - dx);
          setColumnSizes({ sidebar, editor: nextEditor, right: nextRight });
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [columnSizes]
  );

  const startEditorSplitDrag = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      const container = editorSplitRef.current;
      if (!container) return;

      const onMove = (moveEvent: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const offsetY = moveEvent.clientY - rect.top;
        const ratio = Math.min(0.85, Math.max(0.35, offsetY / rect.height));
        setEditorSplit(ratio);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    []
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-title">OpenPrism</div>
          <div className="brand-sub">Agent-driven LaTeX workspace</div>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => setSidebarOpen((prev) => !prev)}>
            {sidebarOpen ? '隐藏侧栏' : '显示侧栏'}
          </button>
          {templates.length > 0 && (
            <select
              value={targetTemplate}
              onChange={(e) => setTargetTemplate(e.target.value)}
              className="select"
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.label}
                </option>
              ))}
            </select>
          )}
          {templates.length > 0 && (
            <button
              className="btn ghost"
              onClick={async () => {
                if (!projectId || !targetTemplate) return;
                setStatus('正在转换模板...');
                try {
                  const res = await convertTemplate({ projectId, targetTemplate, mainFile });
                  if (!res.ok) {
                    throw new Error(res.error || '模板转换失败');
                  }
                  if (res.mainFile) {
                    setMainFile(res.mainFile);
                    await openFile(res.mainFile);
                  }
                  await refreshTree();
                  setStatus(`模板已切换为 ${targetTemplate}`);
                } catch (err) {
                  setStatus(`模板转换失败: ${String(err)}`);
                }
              }}
            >
              应用模板
            </button>
          )}
          <select
            value={mainFile}
            onChange={(e) => setMainFile(e.target.value)}
            className="select"
          >
            {texFiles.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
            {texFiles.length === 0 && <option value="main.tex">main.tex</option>}
          </select>
          <select
            value={compileEngine}
            onChange={(e) => setSettings((prev) => ({ ...prev, compileEngine: e.target.value as CompileEngine }))}
            className="select"
          >
            <option value="swiftlatex">SwiftLaTeX</option>
            <option value="tectonic">Tectonic</option>
            <option value="auto">Auto</option>
          </select>
          <button onClick={saveActiveFile} className="btn ghost">保存</button>
          <button onClick={compile} className="btn" disabled={isCompiling}>
            {isCompiling ? '编译中...' : '编译 PDF'}
          </button>
          <button className="btn ghost" onClick={() => setSettingsOpen(true)}>设置</button>
        </div>
      </header>

      <div className="status-bar">
        <div>{status}</div>
        <div className="status-right">
          Compile: {compileEngine} · Engine: {engineName || '未初始化'}
        </div>
      </div>

      <main
        className="workspace"
        ref={gridRef}
        style={{
          '--col-sidebar': sidebarOpen ? `${columnSizes.sidebar}px` : '0px',
          '--col-sidebar-gap': sidebarOpen ? '10px' : '0px',
          '--col-editor': `${columnSizes.editor}px`,
          '--col-right': `${columnSizes.right}px`
        } as CSSProperties}
      >
        {sidebarOpen && (
          <aside className="panel side-panel">
            <div className="sidebar-tabs">
              <div className="tab-group">
                <button
                  className={`tab-btn ${activeSidebar === 'projects' ? 'active' : ''}`}
                  onClick={() => setActiveSidebar('projects')}
                >
                  Projects
                </button>
                <button
                  className={`tab-btn ${activeSidebar === 'files' ? 'active' : ''}`}
                  onClick={() => setActiveSidebar('files')}
                >
                  Files
                </button>
                <button
                  className={`tab-btn ${activeSidebar === 'agent' ? 'active' : ''}`}
                  onClick={() => setActiveSidebar('agent')}
                >
                  Agent
                </button>
              </div>
              <button className="icon-btn" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
            {activeSidebar === 'projects' ? (
              <>
                <div className="panel-header">
                  <div>Projects</div>
                  <div className="panel-actions">
                    <button className="btn ghost" onClick={beginProjectCreate}>新建项目</button>
                    <button className="btn ghost" onClick={beginProjectRename}>重命名</button>
                    <button className="btn ghost" onClick={removeProject}>删除</button>
                  </div>
                </div>
                <div className="panel-search">
                  <input
                    className="input"
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    placeholder="搜索项目..."
                  />
                </div>
                <div className="project-list">
                  {projectEdit?.kind === 'new' && (
                    <div className="project-row editing">
                      <input
                        className="inline-input"
                        autoFocus
                        value={projectEdit.value}
                        onChange={(event) => setProjectEdit({ ...projectEdit, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            confirmProjectEdit().catch((err) => setStatus(`项目操作失败: ${String(err)}`));
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelProjectEdit();
                          }
                        }}
                        onBlur={() => cancelProjectEdit()}
                        placeholder="新项目名称"
                      />
                    </div>
                  )}
                  {filteredProjects.map((project) => {
                    if (projectEdit?.kind === 'rename' && projectEdit.id === project.id) {
                      return (
                        <div key={project.id} className="project-row editing">
                          <input
                            className="inline-input"
                            autoFocus
                            value={projectEdit.value}
                            onChange={(event) => setProjectEdit({ ...projectEdit, value: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                confirmProjectEdit().catch((err) => setStatus(`项目操作失败: ${String(err)}`));
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelProjectEdit();
                              }
                            }}
                            onBlur={() => cancelProjectEdit()}
                          />
                        </div>
                      );
                    }
                    return (
                      <button
                        key={project.id}
                        className={`project-row ${projectId === project.id ? 'active' : ''}`}
                        onClick={() => setProjectId(project.id)}
                      >
                        <span className="project-name">{project.name}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : activeSidebar === 'files' ? (
              <>
                <div className="panel-header">
                  <div>Project Files</div>
                  <div className="panel-actions">
                    <button className="btn ghost" onClick={() => beginInlineCreate('new-file')}>新建</button>
                    <button className="btn ghost" onClick={() => beginInlineCreate('new-folder')}>新建夹</button>
                    <button className="btn ghost" onClick={createBibFile}>新建Bib</button>
                    <button className="btn ghost" onClick={() => fileInputRef.current?.click()}>上传文件</button>
                    <button className="btn ghost" onClick={() => folderInputRef.current?.click()}>上传文件夹</button>
                    <button className="btn ghost" onClick={() => setAllFolders(true)}>展开</button>
                    <button className="btn ghost" onClick={() => setAllFolders(false)}>收起</button>
                    <button className="btn ghost" onClick={beginInlineRename}>重命名</button>
                    <button className="btn ghost" onClick={() => refreshTree()}>刷新</button>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    handleUpload(event.target.files).catch((err) => setStatus(`上传失败: ${String(err)}`));
                    if (event.target) {
                      event.target.value = '';
                    }
                  }}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
                  onChange={(event) => {
                    handleUpload(event.target.files).catch((err) => setStatus(`上传失败: ${String(err)}`));
                    if (event.target) {
                      event.target.value = '';
                    }
                  }}
                />
                <div className="panel-search">
                  <input
                    className="input"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    placeholder="搜索文件..."
                  />
                </div>
                <div
                  className="file-tree-body"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverPath('');
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                      handleUpload(event.dataTransfer.files).catch((err) => setStatus(`上传失败: ${String(err)}`));
                      return;
                    }
                    const from = event.dataTransfer.getData('text/plain');
                    if (from) {
                      moveFileToFolder(from, '');
                    }
                  }}
                >
                  {inlineEdit && inlineEdit.kind !== 'rename' && inlineEdit.parent === '' && inlineInputRow(0)}
                  {renderTree(treeRoot.children)}
                </div>
              </>
            ) : (
              <>
                <div className="panel-header">
                  <div>{assistantMode === 'chat' ? 'Chat' : 'Agent'}</div>
                  <div className="panel-actions">
                    <div className="mode-toggle">
                      <button
                        className={`mode-btn ${assistantMode === 'chat' ? 'active' : ''}`}
                        onClick={() => setAssistantMode('chat')}
                      >
                        Chat
                      </button>
                      <button
                        className={`mode-btn ${assistantMode === 'agent' ? 'active' : ''}`}
                        onClick={() => setAssistantMode('agent')}
                      >
                        Agent
                      </button>
                    </div>
                  </div>
                </div>
                {assistantMode === 'chat' && (
                  <div className="context-tags">
                    <span className="context-tag">只读当前文件</span>
                    {selectionText && <span className="context-tag">只读选区</span>}
                    {compileLog && <span className="context-tag">只读编译日志</span>}
                  </div>
                )}
                <div className="chat-messages">
                  {assistantMode === 'chat' && chatMessages.length === 0 && (
                    <div className="muted">输入问题，进行只读对话。</div>
                  )}
                  {assistantMode === 'agent' && agentMessages.length === 0 && (
                    <div className="muted">输入任务描述，生成修改建议。</div>
                  )}
                  {(assistantMode === 'chat' ? chatMessages : agentMessages).map((msg, idx) => (
                    <div key={idx} className={`chat-msg ${msg.role}`}>
                      <div className="role">{msg.role}</div>
                      <div className="content">{msg.content}</div>
                    </div>
                  ))}
                </div>
                <div className="chat-controls">
                  <div className="row">
                    {assistantMode === 'agent' ? (
                      <>
                        <select value={task} onChange={(e) => setTask(e.target.value)} className="select">
                          {DEFAULT_TASKS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <select value={mode} onChange={(e) => setMode(e.target.value as 'direct' | 'tools')} className="select">
                          <option value="direct">Direct</option>
                          <option value="tools">Tools</option>
                        </select>
                        <div className="muted">
                          Direct: 单轮生成 · Tools: 多轮工具调用/多文件修改
                        </div>
                      </>
                    ) : (
                      <div className="muted">Chat 模式仅对话，不会改动文件。</div>
                    )}
                  </div>
                  {assistantMode === 'agent' && task === 'translate' && (
                    <div className="row">
                      <select
                        value={translateScope}
                        onChange={(e) => setTranslateScope(e.target.value as 'selection' | 'file' | 'project')}
                        className="select"
                      >
                        <option value="selection">选区</option>
                        <option value="file">当前文件</option>
                        <option value="project">整个项目</option>
                      </select>
                      <select
                        value={translateTarget}
                        onChange={(e) => setTranslateTarget(e.target.value)}
                        className="select"
                      >
                        <option value="English">English</option>
                        <option value="中文">中文</option>
                        <option value="日本語">日本語</option>
                        <option value="한국어">한국어</option>
                        <option value="Français">Français</option>
                        <option value="Deutsch">Deutsch</option>
                        <option value="Español">Español</option>
                      </select>
                    </div>
                  )}
                  <textarea
                    className="chat-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={assistantMode === 'chat' ? '例如：帮我解释这一段的实验设计。' : '例如：润色这个段落，使其更符合 ACL 风格。'}
                  />
                  <button onClick={sendPrompt} className="btn full">
                    {assistantMode === 'chat' ? '发送' : '生成建议'}
                  </button>
                  {selectionText && assistantMode === 'agent' && (
                    <div className="muted">已选择 {selectionText.length} 字符，将用于任务输入</div>
                  )}
                  {assistantMode === 'agent' && task === 'translate' && translateScope === 'selection' && !selectionText && (
                    <div className="muted">翻译选区前请先选择文本。</div>
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        {sidebarOpen && (
          <div
            className="drag-handle vertical sidebar-handle"
            onMouseDown={(e) => startColumnDrag('left', e)}
          />
        )}

        <section className="panel editor-panel">
          <div className="panel-header">Editor</div>
          <div
            className="editor-split"
            ref={editorSplitRef}
            style={{ gridTemplateRows: `${Math.round(editorSplit * 100)}% 8px ${Math.round((1 - editorSplit) * 100)}%` }}
          >
            <div className="editor-area" ref={editorAreaRef}>
              <div ref={editorHostRef} className="editor-host" />
              <div className="editor-hint muted">快捷键: Option/Alt + / 触发 AI 补全，或 Cmd/Ctrl + Space</div>
              {(inlineSuggestionText || isSuggesting) && suggestionPos && (
                <div
                  className={`suggestion-popover ${isSuggesting && !inlineSuggestionText ? 'loading' : ''}`}
                  style={{ left: suggestionPos.left, top: suggestionPos.top }}
                >
                  {isSuggesting && !inlineSuggestionText ? (
                    <div className="suggestion-loading">
                      <span className="spinner" />
                      AI 补全中...
                    </div>
                  ) : (
                    <>
                      <div className="suggestion-preview">{inlineSuggestionText}</div>
                      <div className="row">
                        <button className="btn" onClick={() => acceptSuggestionRef.current()}>接受</button>
                        <button className="btn ghost" onClick={() => clearSuggestionRef.current()}>拒绝</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="drag-handle horizontal" onMouseDown={(e) => startEditorSplitDrag(e)} />
            <div className="compile-log">
              <div className="log-title">
                Compile Log
                {assistantMode === 'agent' && (
                  <button className="btn ghost log-action" onClick={diagnoseCompile}>
                    一键诊断
                  </button>
                )}
              </div>
              {compileErrors.length > 0 && (
                <div className="log-errors">
                  {compileErrors.map((error, idx) => (
                    <button
                      key={`${error.message}-${idx}`}
                      className="error-item"
                      onClick={() => jumpToError(error)}
                    >
                      <span className="error-tag">!</span>
                      <span className="error-text">{error.message}</span>
                      {error.line && <span className="error-line">L{error.line}</span>}
                    </button>
                  ))}
                </div>
              )}
              <pre>{compileLog || '暂无编译日志'}</pre>
            </div>
          </div>
        </section>

        <div
          className="drag-handle vertical main-handle"
          onMouseDown={(e) => startColumnDrag('right', e)}
        />

        <section className="panel pdf-panel">
          <div className="panel-header">
            <div>Preview</div>
          </div>
          <div className="right-body">
            <div className="view-selector">
              <button className={`selector-btn ${rightView === 'pdf' ? 'active' : ''}`} onClick={() => setRightView('pdf')}>PDF</button>
              <button className={`selector-btn ${rightView === 'figures' ? 'active' : ''}`} onClick={() => setRightView('figures')}>FIG</button>
              <button className={`selector-btn ${rightView === 'diff' ? 'active' : ''}`} onClick={() => setRightView('diff')}>DIFF</button>
            </div>
            <div className="view-content">
              {rightView === 'pdf' && (
                <>
                  <div className="pdf-toolbar">
                    <div className="toolbar-group">
                      <button className="icon-btn" onClick={() => zoomPdf(-0.1)} disabled={!pdfUrl}>−</button>
                      <div className="zoom-label">{pdfScaleLabel}</div>
                      <button className="icon-btn" onClick={() => zoomPdf(0.1)} disabled={!pdfUrl}>＋</button>
                      <button className="btn ghost small" onClick={() => setPdfFitWidth(true)} disabled={!pdfUrl}>适合宽度</button>
                      <button
                        className="btn ghost small"
                        onClick={() => {
                          setPdfFitWidth(false);
                          setPdfScale(1);
                        }}
                        disabled={!pdfUrl}
                      >
                        100%
                      </button>
                    </div>
                    <div className="toolbar-group">
                      <button className="btn ghost small" onClick={downloadPdf} disabled={!pdfUrl}>下载 PDF</button>
                    </div>
                  </div>
                  {pdfUrl ? (
                    <PdfPreview
                      pdfUrl={pdfUrl}
                      scale={pdfScale}
                      fitWidth={pdfFitWidth}
                      onFitScale={handleFitScale}
                      onTextClick={(text) => {
                        const view = cmViewRef.current;
                        if (!view) return;
                        const docText = view.state.doc.toString();
                        const needle = text.replace(/\s+/g, ' ').trim();
                        if (!needle) return;
                        const idx = docText.indexOf(needle);
                        if (idx >= 0) {
                          view.dispatch({
                            selection: { anchor: idx, head: idx + needle.length },
                            scrollIntoView: true
                          });
                          view.focus();
                        }
                      }}
                    />
                  ) : (
                    <div className="muted">尚未生成 PDF</div>
                  )}
                </>
              )}
              {rightView === 'figures' && (
                <div className="figure-panel">
                  <div className="figure-list">
                    {figureFiles.map((item) => (
                      <button
                        key={item.path}
                        className={`figure-item ${selectedFigure === item.path ? 'active' : ''}`}
                        onClick={() => setSelectedFigure(item.path)}
                      >
                        {item.path}
                      </button>
                    ))}
                    {figureFiles.length === 0 && (
                      <div className="muted">暂无图片文件。</div>
                    )}
                  </div>
                  <div className="figure-preview">
                    {selectedFigure ? (
                      selectedFigure.toLowerCase().endsWith('.pdf') ? (
                        <object data={`/api/projects/${projectId}/blob?path=${encodeURIComponent(selectedFigure)}`} type="application/pdf" />
                      ) : (
                        <img src={`/api/projects/${projectId}/blob?path=${encodeURIComponent(selectedFigure)}`} alt={selectedFigure} />
                      )
                    ) : (
                      <div className="muted">选择图片进行预览。</div>
                    )}
                  </div>
                  {selectedFigure && (
                    <div className="figure-actions">
                      <button className="btn ghost" onClick={() => insertFigureSnippet(selectedFigure)}>插入图模板</button>
                    </div>
                  )}
                </div>
              )}
              {rightView === 'diff' && (
                <div className="diff-panel">
                  <div className="diff-title">Diff Preview ({pendingGrouped.length})</div>
                  {pendingGrouped.length === 0 && <div className="muted">暂无待确认修改。</div>}
                  {pendingGrouped.map((change) => (
                    (() => {
                      const rows = buildSplitDiff(change.original, change.proposed);
                      return (
                        <div key={change.filePath} className="diff-item">
                          <div className="diff-header">
                            <div className="diff-path">{change.filePath}</div>
                            <button className="btn ghost" onClick={() => setDiffFocus(change)}>放大</button>
                          </div>
                          <SplitDiffView rows={rows} />
                          <div className="row">
                            <button className="btn" onClick={() => applyPending(change)}>应用此修改</button>
                            <button className="btn ghost" onClick={() => discardPending(change)}>放弃</button>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                  {pendingGrouped.length > 1 && (
                    <div className="row">
                      <button className="btn" onClick={() => applyPending()}>应用全部</button>
                      <button className="btn ghost" onClick={() => discardPending()}>全部放弃</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>Workspace Settings</div>
              <button className="icon-btn" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>TexLive Endpoint</label>
                <input
                  className="input"
                  value={texliveEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, texliveEndpoint: e.target.value }))}
                  placeholder="https://texlive.swiftlatex.com"
                />
              </div>
              <div className="field">
                <label>LLM Endpoint</label>
                <input
                  className="input"
                  value={llmEndpoint}
                  onChange={(e) => setSettings((prev) => ({ ...prev, llmEndpoint: e.target.value }))}
                  placeholder="https://api.openai.com/v1/chat/completions"
                />
                <div className="muted">支持 OpenAI 兼容的 base_url，例如 https://api.apiyi.com/v1</div>
              </div>
              <div className="field">
                <label>LLM Model</label>
                <input
                  className="input"
                  value={llmModel}
                  onChange={(e) => setSettings((prev) => ({ ...prev, llmModel: e.target.value }))}
                  placeholder="gpt-4o-mini"
                />
              </div>
              <div className="field">
                <label>LLM API Key</label>
                <input
                  className="input"
                  value={llmApiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, llmApiKey: e.target.value }))}
                  placeholder="sk-..."
                  type="password"
                />
                {!llmApiKey && (
                  <div className="muted">未配置 API Key 时将使用后端环境变量。</div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSettingsOpen(false)}>关闭</button>
              <button className="btn" onClick={() => setSettingsOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      )}
      {diffFocus && (
        <div className="modal-backdrop" onClick={() => setDiffFocus(null)}>
          <div className="modal diff-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>Diff · {diffFocus.filePath}</div>
              <button className="icon-btn" onClick={() => setDiffFocus(null)}>✕</button>
            </div>
            <div className="modal-body diff-modal-body">
              <SplitDiffView rows={buildSplitDiff(diffFocus.original, diffFocus.proposed)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
