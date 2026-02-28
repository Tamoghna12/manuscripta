import { useEffect, useRef, useState, useCallback } from 'react';
import { writeFile } from '../../api/client';

interface MermaidPanelProps {
  source: string;
  projectId: string;
  onInsertFigure: (path: string) => void;
}

interface MermaidBlock {
  index: number;
  code: string;
}

function extractMermaidBlocks(source: string): MermaidBlock[] {
  const re = /\\begin\{mermaid\}([\s\S]*?)\\end\{mermaid\}/g;
  const blocks: MermaidBlock[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(source)) !== null) {
    blocks.push({ index: i++, code: m[1].trim() });
  }
  return blocks;
}

export default function MermaidPanel({ source, projectId, onInsertFigure }: MermaidPanelProps) {
  const [blocks, setBlocks] = useState<MermaidBlock[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [svgContent, setSvgContent] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mermaidRef = useRef<typeof import('mermaid') | null>(null);

  useEffect(() => {
    setBlocks(extractMermaidBlocks(source));
  }, [source]);

  useEffect(() => {
    if (activeTab >= blocks.length) setActiveTab(0);
  }, [blocks.length, activeTab]);

  const renderDiagram = useCallback(async (code: string) => {
    setError('');
    setSvgContent('');
    try {
      if (!mermaidRef.current) {
        mermaidRef.current = await import('mermaid');
        mermaidRef.current.default.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          securityLevel: 'strict',
        });
      }
      const id = `mermaid-${Date.now()}`;
      const { svg } = await mermaidRef.current.default.render(id, code);
      setSvgContent(svg);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Mermaid render failed');
    }
  }, []);

  useEffect(() => {
    if (blocks.length > 0 && blocks[activeTab]) {
      renderDiagram(blocks[activeTab].code);
    } else {
      setSvgContent('');
    }
  }, [blocks, activeTab, renderDiagram]);

  const handleExportSvg = async () => {
    if (!svgContent || !projectId) return;
    setExporting(true);
    try {
      const filename = `figures/mermaid-diagram-${activeTab + 1}.svg`;
      await writeFile(projectId, filename, svgContent);
      onInsertFigure(filename);
    } catch {
      setError('Failed to save SVG file');
    } finally {
      setExporting(false);
    }
  };

  if (blocks.length === 0) {
    return (
      <div className="mermaid-panel">
        <div className="muted" style={{ padding: 16 }}>
          No mermaid blocks found. Use <code>\begin{'{'}mermaid{'}'}</code> ... <code>\end{'{'}mermaid{'}'}</code> in your LaTeX source.
        </div>
      </div>
    );
  }

  return (
    <div className="mermaid-panel">
      {blocks.length > 1 && (
        <div className="mermaid-block-tabs">
          {blocks.map((b) => (
            <button
              key={b.index}
              className={`right-tab ${activeTab === b.index ? 'active' : ''}`}
              onClick={() => setActiveTab(b.index)}
            >
              Diagram {b.index + 1}
            </button>
          ))}
        </div>
      )}
      <div className="mermaid-toolbar">
        <button
          className="btn ghost small"
          onClick={handleExportSvg}
          disabled={!svgContent || exporting}
        >
          {exporting ? 'Saving...' : 'Export as SVG'}
        </button>
      </div>
      {error && <div className="mermaid-error">{error}</div>}
      <div
        className="mermaid-svg-container"
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
