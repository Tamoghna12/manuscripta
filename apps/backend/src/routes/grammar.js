import { callOpenAICompatible, resolveLLMConfig } from '../services/llmService.js';
import { extractJSON, sanitizeContent } from '../services/llmValidation.js';

const GRAMMAR_FULL_SYSTEM = `You are an expert academic English editor specializing in scientific and technical writing.
Analyze the following LaTeX text for English language issues. Ignore LaTeX commands, equations, and citations. Focus ONLY on the natural language text.

Check for:
1. Grammar errors (subject-verb agreement, tense consistency, article usage)
2. Spelling mistakes
3. Awkward phrasing / non-native constructions
4. Academic style violations (informal language, contractions, first-person overuse)
5. Punctuation errors
6. Word choice improvements (suggest more precise academic vocabulary)
7. Sentence structure (run-on sentences, fragments, dangling modifiers)

Return a JSON array of issues. Each issue must have these keys:
- "line": approximate line number (integer)
- "original": the exact problematic text (string)
- "replacement": the corrected text (string)
- "category": one of "grammar", "spelling", "style", "punctuation", "vocabulary", "structure"
- "severity": one of "error", "warning", "suggestion"
- "explanation": brief reason for the correction (string)

Return ONLY the JSON array, no markdown fences, no extra text.
If there are no issues, return an empty array: []`;

const GRAMMAR_INLINE_SYSTEM = `You are an academic English grammar checker. Given a short text excerpt from a LaTeX document, identify English language issues. Ignore LaTeX commands and equations.

Return a JSON array of issues. Each issue: {"original":"<exact text>","replacement":"<fixed text>","category":"grammar|spelling|style|punctuation|vocabulary|structure","severity":"error|warning|suggestion","explanation":"<brief reason>"}

Return ONLY the JSON array. If no issues, return [].`;

export function registerGrammarRoutes(fastify) {
  // Full document grammar check
  fastify.post('/api/grammar/check', async (req) => {
    const { content, llmConfig, mode = 'full' } = req.body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return { ok: true, issues: [] };
    }

    const resolved = resolveLLMConfig(llmConfig);
    const systemPrompt = mode === 'inline' ? GRAMMAR_INLINE_SYSTEM : GRAMMAR_FULL_SYSTEM;

    // Truncate to prevent token overflow on very large documents
    const maxChars = mode === 'inline' ? 3000 : 30000;
    const truncatedContent = content.length > maxChars ? content.slice(0, maxChars) + '\n[...truncated]' : content;

    const result = await callOpenAICompatible({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: truncatedContent }
      ],
      model: llmConfig?.grammarModel || resolved.model,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });

    if (!result.ok) {
      return { ok: false, error: result.error, issues: [] };
    }

    // Parse the JSON array from the response using robust extraction
    const parsed = extractJSON(sanitizeContent(result.content));
    const issues = Array.isArray(parsed) ? parsed : [];

    return { ok: true, issues };
  });

  // Quick inline grammar check (for real-time underlines)
  fastify.post('/api/grammar/inline', async (req) => {
    const { content, llmConfig } = req.body || {};

    if (!content || typeof content !== 'string' || content.trim().length < 10) {
      return { ok: true, issues: [] };
    }

    const resolved = resolveLLMConfig(llmConfig);

    const result = await callOpenAICompatible({
      messages: [
        { role: 'system', content: GRAMMAR_INLINE_SYSTEM },
        { role: 'user', content: content.slice(0, 3000) }
      ],
      model: llmConfig?.grammarModel || resolved.model,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });

    if (!result.ok) {
      return { ok: false, error: result.error, issues: [] };
    }

    let issues = [];
    try {
      let text = result.content.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      issues = JSON.parse(text);
      if (!Array.isArray(issues)) {
        issues = [];
      }
    } catch {
      issues = [];
    }

    return { ok: true, issues };
  });
}
