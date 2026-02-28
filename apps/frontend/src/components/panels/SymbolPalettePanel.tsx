import { useState, useMemo } from 'react';
import { SYMBOL_CATEGORIES } from '../../data/latexSymbols';

interface SymbolPalettePanelProps {
  onInsert: (text: string) => void;
}

export default function SymbolPalettePanel({ onInsert }: SymbolPalettePanelProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return SYMBOL_CATEGORIES;
    return SYMBOL_CATEGORIES.map((cat) => ({
      ...cat,
      symbols: cat.symbols.filter(
        (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.symbols.length > 0);
  }, [search]);

  return (
    <div className="symbol-palette-panel">
      <input
        className="input"
        type="text"
        placeholder="Search symbols..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ margin: '8px 12px', width: 'calc(100% - 24px)' }}
      />
      <div className="symbol-palette-scroll">
        {filtered.length === 0 && <div className="muted" style={{ padding: '12px' }}>No symbols found.</div>}
        {filtered.map((cat) => (
          <div key={cat.label}>
            <div className="symbol-category-header">{cat.label}</div>
            <div className="symbol-grid">
              {cat.symbols.map((sym) => (
                <button
                  key={sym.command}
                  className="symbol-btn"
                  title={`${sym.name}\n${sym.command}`}
                  onClick={() => onInsert(sym.command)}
                >
                  <span className="symbol-glyph">{sym.unicode}</span>
                  <span className="symbol-cmd">{sym.command}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
