import path from 'path';
import { safeJoin, sanitizeUploadPath } from '../utils/pathUtils.js';
import { ensureDir } from '../utils/fsUtils.js';
import { getProjectRoot } from '../services/projectService.js';
import { resolveLLMConfig, callOpenAICompatible } from '../services/llmService.js';
import { runPythonPlot } from '../services/plotService.js';

export function registerPlotRoutes(fastify) {
  fastify.post('/api/plot/from-table', async (req) => {
    const { projectId, tableLatex, chartType, title, prompt, filename, llmConfig } = req.body || {};
    if (!projectId) return { ok: false, error: 'Missing projectId.' };
    if (!tableLatex) return { ok: false, error: 'Missing tableLatex.' };
    const projectRoot = await getProjectRoot(projectId);
    const safeNameBase = sanitizeUploadPath(filename || `plot_${Date.now()}.png`) || `plot_${Date.now()}.png`;
    const ext = path.extname(safeNameBase);
    const finalName = ext ? safeNameBase : `${safeNameBase}.png`;
    const assetRel = path.join('assets', 'plots', finalName);
    const abs = safeJoin(projectRoot, assetRel);
    await ensureDir(path.dirname(abs));

    const resolved = resolveLLMConfig(llmConfig);
    if (!resolved.apiKey) {
      return { ok: false, error: 'OPENPRISM_LLM_API_KEY not set' };
    }
    const system = [
      'You generate python plotting code using seaborn/matplotlib.',
      'A pandas DataFrame `df` and numeric DataFrame `df_numeric` are provided.',
      'Do not import packages. Do not call plt.savefig.',
      'Use chart_type if helpful.'
    ].join(' ');
    const user = [
      `chart_type: ${chartType || 'bar'}`,
      prompt ? `user_prompt: ${prompt}` : '',
      'Return ONLY python code.'
    ].filter(Boolean).join('\n');
    const codeRes = await callOpenAICompatible({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      model: resolved.model,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });
    if (!codeRes.ok || !codeRes.content) {
      return { ok: false, error: codeRes.error || 'Plot code generation failed.' };
    }
    const plotCode = String(codeRes.content)
      .replace(/```python/g, '')
      .replace(/```/g, '')
      .trim();

    const payload = {
      tableLatex,
      chartType,
      title,
      outputPath: abs,
      plotCode
    };
    const result = await runPythonPlot(payload);
    if (!result.ok) {
      return { ok: false, error: result.error || 'Plot render failed.' };
    }
    return { ok: true, assetPath: assetRel.replace(/\\/g, '/') };
  });
}
