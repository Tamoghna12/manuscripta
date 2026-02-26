import { callOpenAICompatible } from '../services/llmService.js';
import { runToolAgent } from '../services/agentService.js';
import { validateAgentResponse, sanitizeContent } from '../services/llmValidation.js';
import { getLang, t } from '../i18n/index.js';

const CHAT_SYSTEM_PROMPT = [
  'You are an expert academic writing assistant with deep knowledge of scientific publishing',
  'conventions, LaTeX typesetting, and research methodology. You help researchers write clearer,',
  'more rigorous, and more publishable papers.',
  'When reviewing text:',
  '- Cite specific style guide conventions (APA, IEEE, Nature) when relevant.',
  '- Flag logical gaps, unsupported claims, and vague language.',
  '- Suggest concrete improvements, not just identify problems.',
  '- Be direct and honest — academic writing benefits from frank feedback.',
  'This is chat-only mode: do not propose edits, patches, or JSON.',
  'Respond concisely. Use markdown formatting for clarity.'
].join(' ');

const TASK_SYSTEM_PROMPTS = {
  polish: [
    'You are an expert academic English editor.',
    'Polish the given LaTeX text for publication quality.',
    'Focus on: academic register, precision, conciseness, subject-verb agreement,',
    'article usage, tense consistency, and appropriate hedging language.',
    'Preserve all LaTeX commands and structure.',
    'Return JSON with keys: reply (brief explanation of changes), suggestion (the polished text).'
  ].join(' '),

  rewrite: [
    'You are an expert academic writing assistant.',
    'Rewrite the given text to improve clarity, flow, and readability while maintaining the original meaning.',
    'Ensure the rewrite is suitable for a peer-reviewed publication.',
    'Preserve all LaTeX commands and structure.',
    'Return JSON with keys: reply (brief explanation), suggestion (the rewritten text).'
  ].join(' '),

  structure: [
    'You are an expert academic writing assistant specializing in paper structure.',
    'Reorganize the given text for better logical flow following standard academic conventions.',
    'Consider the venue/format (conference vs journal) when restructuring.',
    'Preserve all LaTeX commands and structure.',
    'Return JSON with keys: reply (brief explanation), suggestion (the restructured text).'
  ].join(' '),

  translate: [
    'You are an expert academic translator.',
    'Translate the given text preserving technical terminology, LaTeX commands, and academic style.',
    'Ensure translated text reads naturally in the target language while maintaining precision.',
    'Return JSON with keys: reply (brief note), suggestion (the translated text).'
  ].join(' '),

  'fix-errors': [
    'You are an expert LaTeX debugger.',
    'Analyze the compile log and fix the errors in the given LaTeX text.',
    'Common issues: missing \\end{}, unmatched braces, undefined references, missing packages.',
    'Preserve all content — only fix the errors.',
    'Return JSON with keys: reply (list of errors fixed), suggestion (the corrected text).'
  ].join(' '),

  'add-references': [
    'You are an expert academic researcher.',
    'Add appropriate citations and references to the given LaTeX text.',
    'Insert \\cite{} at claims that need support. Suggest BibTeX entries.',
    'Return JSON with keys: reply (what references were added and why), suggestion (text with \\cite{} inserted).'
  ].join(' '),

  autocomplete: [
    'You are an autocomplete engine for LaTeX.',
    'Only return JSON with keys: reply, suggestion.',
    'suggestion must be the continuation text after the cursor.',
    'Do not include explanations or code fences.'
  ].join(' '),

  default: [
    'You are an expert academic writing assistant for LaTeX papers.',
    'Return a concise response and a suggested rewrite for the selection or full content.',
    'Focus on academic rigor, clarity, and precision.',
    'Output in JSON with keys: reply, suggestion.'
  ].join(' ')
};

export function registerAgentRoutes(fastify) {
  fastify.post('/api/agent/run', async (req) => {
    const lang = getLang(req);
    const {
      task = 'polish',
      prompt = '',
      selection = '',
      content = '',
      mode = 'direct',
      projectId,
      activePath,
      compileLog,
      llmConfig,
      interaction = 'agent',
      history = []
    } = req.body || {};

    if (interaction === 'chat') {
      const safeHistory = Array.isArray(history)
        ? history.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        : [];

      const user = [
        prompt ? `User Prompt: ${prompt}` : '',
        selection ? `Selection (read-only):\n${selection}` : '',
        selection ? '' : (content ? `Current File (read-only):\n${content}` : ''),
        compileLog ? `Compile Log (read-only):\n${compileLog}` : ''
      ].filter(Boolean).join('\n\n');

      const result = await callOpenAICompatible({
        messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...safeHistory, { role: 'user', content: user }],
        model: llmConfig?.model,
        endpoint: llmConfig?.endpoint,
        apiKey: llmConfig?.apiKey
      });

      if (!result.ok) {
        return {
          ok: false,
          reply: t(lang, 'llm_error', { error: result.error || 'unknown error' }),
          suggestion: ''
        };
      }

      return { ok: true, reply: sanitizeContent(result.content || ''), suggestion: '' };
    }

    if (mode === 'tools') {
      return runToolAgent({ projectId, activePath, task, prompt, selection, compileLog, llmConfig, lang });
    }

    // Direct mode: use task-specific system prompts
    const system = TASK_SYSTEM_PROMPTS[task] || TASK_SYSTEM_PROMPTS.default;

    const user = [
      `Task: ${task}`,
      mode === 'tools' ? 'Mode: tools (use extra reasoning)' : 'Mode: direct',
      prompt ? `User Prompt: ${prompt}` : '',
      selection ? `Selection:\n${selection}` : '',
      selection ? '' : `Full Content:\n${content}`
    ].filter(Boolean).join('\n\n');

    const result = await callOpenAICompatible({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      model: llmConfig?.model,
      endpoint: llmConfig?.endpoint,
      apiKey: llmConfig?.apiKey
    });

    if (!result.ok) {
      return {
        ok: false,
        reply: t(lang, 'llm_error', { error: result.error || 'unknown error' }),
        suggestion: ''
      };
    }

    const validated = validateAgentResponse(result.content);
    return {
      ok: true,
      reply: validated.reply,
      suggestion: validated.suggestion,
      latexWarnings: validated.latexWarnings,
    };
  });
}
