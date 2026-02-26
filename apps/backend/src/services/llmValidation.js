/**
 * LLM output validation and sanitization layer.
 *
 * Provides post-processing for LLM responses:
 * - JSON extraction from markdown-fenced responses
 * - LaTeX syntax validation (balanced braces, environments, commands)
 * - Content length and safety checks
 * - Graceful fallback on validation failures
 */

/**
 * Extract JSON from LLM response that may be wrapped in markdown code fences.
 * Tries multiple strategies:
 *   1. Direct JSON.parse
 *   2. Extract from ```json ... ``` fences
 *   3. Extract from ``` ... ``` fences
 *   4. Find first { ... } or [ ... ] block
 */
export function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // 2. Markdown fenced code block
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* continue */ }
  }

  // 3. Find first JSON object or array
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  const startChar = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket) ? '{' : '[';
  const endChar = startChar === '{' ? '}' : ']';
  const startIdx = startChar === '{' ? firstBrace : firstBracket;

  if (startIdx >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === startChar) depth++;
      if (ch === endChar) depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(startIdx, i + 1));
        } catch { break; }
      }
    }
  }

  return null;
}

/**
 * Validate LaTeX content for common structural errors.
 * Returns { valid: boolean, warnings: string[] }.
 *
 * Checks:
 * - Balanced curly braces
 * - Matched \begin{env} / \end{env}
 * - No obviously broken commands (e.g., dangling backslash at end)
 */
export function validateLatex(content) {
  if (!content || typeof content !== 'string') {
    return { valid: true, warnings: [] };
  }

  const warnings = [];

  // Check balanced braces (ignoring escaped ones)
  let braceDepth = 0;
  let inComment = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\n') { inComment = false; continue; }
    if (inComment) continue;
    if (ch === '%' && (i === 0 || content[i - 1] !== '\\')) { inComment = true; continue; }
    if (ch === '\\' && i + 1 < content.length) { i++; continue; } // skip escaped char
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
    if (braceDepth < 0) {
      warnings.push(`Unmatched closing brace at position ${i}`);
      braceDepth = 0;
    }
  }
  if (braceDepth > 0) {
    warnings.push(`${braceDepth} unclosed brace(s)`);
  }

  // Check matched environments
  const beginRe = /\\begin\{([^}]+)\}/g;
  const endRe = /\\end\{([^}]+)\}/g;
  const envStack = [];
  const begins = [];
  const ends = [];
  let m;
  while ((m = beginRe.exec(content)) !== null) begins.push(m[1]);
  while ((m = endRe.exec(content)) !== null) ends.push(m[1]);

  // Simple count check per environment
  const beginCounts = {};
  const endCounts = {};
  for (const e of begins) beginCounts[e] = (beginCounts[e] || 0) + 1;
  for (const e of ends) endCounts[e] = (endCounts[e] || 0) + 1;

  for (const env of new Set([...Object.keys(beginCounts), ...Object.keys(endCounts)])) {
    const bc = beginCounts[env] || 0;
    const ec = endCounts[env] || 0;
    if (bc !== ec) {
      warnings.push(`Environment '${env}': ${bc} \\begin vs ${ec} \\end`);
    }
  }

  // Check for dangling backslash at end
  const trimmed = content.trimEnd();
  if (trimmed.endsWith('\\') && !trimmed.endsWith('\\\\')) {
    warnings.push('Content ends with a dangling backslash');
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Sanitize LLM-generated content:
 * - Remove potential prompt injection markers
 * - Strip excessive whitespace
 * - Truncate to maxLength
 */
export function sanitizeContent(content, { maxLength = 500_000 } = {}) {
  if (!content || typeof content !== 'string') return '';

  let result = content;

  // Remove common prompt injection patterns
  result = result.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '');
  result = result.replace(/<\|(?:im_start|im_end|system|user|assistant)\|>/gi, '');
  result = result.replace(/<<SYS>>[\s\S]*?<<\/SYS>>/gi, '');

  // Truncate
  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  return result;
}

/**
 * Validate and process an LLM response for the agent route.
 *
 * Expected JSON format: { reply: string, suggestion?: string }
 * Falls back gracefully if JSON parsing fails.
 */
export function validateAgentResponse(rawContent) {
  const sanitized = sanitizeContent(rawContent);
  const json = extractJSON(sanitized);

  if (json && typeof json === 'object') {
    const reply = typeof json.reply === 'string' ? json.reply : '';
    const suggestion = typeof json.suggestion === 'string' ? json.suggestion : '';

    // Validate LaTeX in suggestion if present
    let latexWarnings = [];
    if (suggestion) {
      const validation = validateLatex(suggestion);
      latexWarnings = validation.warnings;
    }

    return {
      ok: true,
      reply: reply || sanitized,
      suggestion,
      latexWarnings,
    };
  }

  // Fallback: treat entire content as reply
  return {
    ok: true,
    reply: sanitized,
    suggestion: '',
    latexWarnings: [],
  };
}
