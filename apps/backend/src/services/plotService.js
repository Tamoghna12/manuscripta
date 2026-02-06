import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { ensureDir } from '../utils/fsUtils.js';

export async function runPythonPlot(payload) {
  const runId = crypto.randomUUID();
  const tmpDir = path.join('/tmp', `openprism_plot_${runId}`);
  await ensureDir(tmpDir);
  const payloadPath = path.join(tmpDir, 'payload.json');
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');
  const pythonScript = `
import json, os, sys, re, importlib.util
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HAS_PANDAS = importlib.util.find_spec("pandas") is not None
HAS_SEABORN = importlib.util.find_spec("seaborn") is not None
pd = None
sns = None
if HAS_PANDAS:
    import pandas as pd
if HAS_SEABORN:
    import seaborn as sns


def parse_table(latex):
    m = re.search(r'\\\\begin{tabular}.*?\\\\end{tabular}', latex, re.S)
    if m:
        latex = m.group(0)
    latex = re.sub(r'\\\\begin{tabular}{[^}]*}', '', latex)
    latex = re.sub(r'\\\\end{tabular}', '', latex)
    latex = re.sub(r'\\\\(toprule|midrule|bottomrule|hline)', '', latex)
    latex = latex.replace('\\\\\\n', '\\\\\\\\')
    rows = [r.strip() for r in latex.split('\\\\\\\\') if r.strip()]
    data = []
    for row in rows:
        if row.strip().startswith('%'):
            continue
        cells = [c.strip() for c in row.split('&')]
        if len(cells) == 1 and cells[0] == '':
            continue
        data.append(cells)
    return data


def is_number(val):
    try:
        float(val)
        return True
    except Exception:
        return False


def pick_col(columns, spec, fallback_idx):
    if spec is not None:
        spec = str(spec).strip()
        if spec.isdigit():
            idx = int(spec) - 1
            if 0 <= idx < len(columns):
                return columns[idx]
        if spec in columns:
            return spec
    if 0 <= fallback_idx < len(columns):
        return columns[fallback_idx]
    return columns[0]


payload = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
latex = payload.get('tableLatex', '')
chart_type = payload.get('chartType', 'bar')
title = payload.get('title', '')
output_path = payload.get('outputPath', '')
plot_code = payload.get('plotCode', '')

if not latex or not output_path:
    raise RuntimeError('Missing input or output path')

data = parse_table(latex)
if not data:
    raise RuntimeError('No table rows parsed')

if all(not is_number(c) for c in data[0]):
    header = data[0]
    rows = data[1:]
else:
    header = [f'col{i+1}' for i in range(len(data[0]))]
    rows = data

if not rows:
    raise RuntimeError('No data rows after header')

plt.figure(figsize=(6, 4))
if plot_code and HAS_PANDAS and HAS_SEABORN:
    df = pd.DataFrame(rows, columns=header)
    df_numeric = df.copy()
    for col in df_numeric.columns:
        df_numeric[col] = pd.to_numeric(df_numeric[col], errors='coerce')
    exec(plot_code, {"df": df, "df_numeric": df_numeric, "sns": sns, "plt": plt})
else:
    # Fallback: matplotlib-only
    numeric_cols = []
    for i in range(len(header)):
        if any(i < len(r) and is_number(r[i]) for r in rows):
            numeric_cols.append(i)
    if not numeric_cols:
        raise RuntimeError('No numeric columns for plotting')

    label_col = None
    if 0 not in numeric_cols and len(header) > 1:
        label_col = 0
    x_labels = [r[label_col] if label_col is not None and len(r) > label_col else str(idx) for idx, r in enumerate(rows)]
    value_cols = [i for i in numeric_cols if i != label_col]
    if not value_cols:
        value_cols = numeric_cols

    x_positions = list(range(len(rows)))
    series = []
    for col in value_cols:
        y_vals = []
        for r in rows:
            if col < len(r) and is_number(r[col]):
                y_vals.append(float(r[col]))
            else:
                y_vals.append(0.0)
        series.append((header[col] if col < len(header) else f'col{col+1}', y_vals))

    if chart_type == 'heatmap':
        matrix = []
        for r in rows:
            row_vals = []
            for col in value_cols:
                if col < len(r) and is_number(r[col]):
                    row_vals.append(float(r[col]))
                else:
                    row_vals.append(0.0)
            matrix.append(row_vals)
        plt.imshow(matrix, aspect='auto', cmap='viridis')
        plt.xticks(range(len(value_cols)), [header[c] for c in value_cols], rotation=30, ha='right')
        plt.yticks(range(len(rows)), x_labels)
    elif chart_type == 'line':
        for idx, (label, y_vals) in enumerate(series):
            plt.plot(x_positions, y_vals, marker='o', label=label)
        plt.xticks(x_positions, x_labels, rotation=30, ha='right')
        if len(series) > 1:
            plt.legend()
    else:
        width = 0.8 / max(1, len(series))
        for idx, (label, y_vals) in enumerate(series):
            offset = (idx - (len(series) - 1) / 2) * width
            positions = [x + offset for x in x_positions]
            plt.bar(positions, y_vals, width=width, label=label)
        plt.xticks(x_positions, x_labels, rotation=30, ha='right')
        if len(series) > 1:
            plt.legend()

if title:
    plt.title(title)
plt.tight_layout()
os.makedirs(os.path.dirname(output_path), exist_ok=True)
plt.savefig(output_path, dpi=150)
`;
  const scriptPath = path.join(tmpDir, 'plot.py');
  await fs.writeFile(scriptPath, pythonScript, 'utf8');

  return new Promise((resolve) => {
    const proc = spawn('python3', [scriptPath, payloadPath], { cwd: tmpDir });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', async (code) => {
      await fs.rm(tmpDir, { recursive: true, force: true });
      if (code !== 0) {
        resolve({ ok: false, error: stderr || stdout || `Python exited with ${code}` });
        return;
      }
      resolve({ ok: true });
    });
  });
}
