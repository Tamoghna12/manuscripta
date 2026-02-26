export function normalizeChatEndpoint(endpoint) {
  if (!endpoint) return 'https://api.openai.com/v1/chat/completions';
  let url = endpoint.trim();
  if (!url) return 'https://api.openai.com/v1/chat/completions';
  url = url.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v1$/i.test(url)) return `${url}/chat/completions`;
  if (/\/v1\//i.test(url)) return url;
  return `${url}/v1/chat/completions`;
}

export function normalizeBaseURL(endpoint) {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.replace(/\/chat\/completions$/i, '');
}

export function resolveLLMConfig(llmConfig) {
  return {
    endpoint: (llmConfig?.endpoint || process.env.MANUSCRIPTA_LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions').trim(),
    apiKey: (llmConfig?.apiKey || process.env.MANUSCRIPTA_LLM_API_KEY || '').trim(),
    model: (llmConfig?.model || process.env.MANUSCRIPTA_LLM_MODEL || 'gpt-4o').trim()
  };
}

/**
 * Detect provider from endpoint URL.
 * Returns: 'anthropic' | 'ollama' | 'zai' | 'openai-compatible'
 */
export function resolveProvider(endpoint) {
  if (!endpoint) return 'openai-compatible';
  const lower = endpoint.toLowerCase();
  if (lower.includes('api.anthropic.com')) return 'anthropic';
  if (lower.includes('localhost:11434') || lower.includes('127.0.0.1:11434') || lower.includes('ollama')) return 'ollama';
  if (lower.includes('api.z.ai') || lower.includes('open.bigmodel.cn')) return 'zai';
  return 'openai-compatible';
}

/**
 * Call Anthropic Messages API directly.
 */
async function callAnthropic({ messages, model, apiKey }) {
  const finalApiKey = (apiKey || process.env.MANUSCRIPTA_LLM_API_KEY || '').trim();
  const finalModel = (model || 'claude-sonnet-4-5-20250929').trim();

  if (!finalApiKey) {
    return { ok: false, error: 'API key not set for Anthropic' };
  }

  // Extract system message from the messages array
  let systemContent = '';
  const nonSystemMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemContent += (systemContent ? '\n' : '') + msg.content;
    } else {
      nonSystemMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const body = {
    model: finalModel,
    max_tokens: 8192,
    temperature: 0.2,
    messages: nonSystemMessages
  };
  if (systemContent) {
    body.system = systemContent;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': finalApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text || `Anthropic request failed with ${res.status}` };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Anthropic response JSON parse failed.' };
    }

    // Anthropic returns content as an array of content blocks
    const content = (data?.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: `Anthropic call failed: ${err.message}` };
  }
}

/**
 * Call OpenAI-compatible endpoint (works for OpenAI, Z.AI, Ollama, and other compatible providers).
 */
async function callOpenAIFormat({ messages, model, endpoint, apiKey }) {
  const finalEndpoint = normalizeChatEndpoint(endpoint || process.env.MANUSCRIPTA_LLM_ENDPOINT);
  const finalApiKey = (apiKey || process.env.MANUSCRIPTA_LLM_API_KEY || '').trim();
  const finalModel = (model || process.env.MANUSCRIPTA_LLM_MODEL || 'gpt-4o').trim();

  const provider = resolveProvider(endpoint);
  const headers = { 'Content-Type': 'application/json' };

  // Ollama doesn't need auth; others use Bearer token
  if (provider !== 'ollama') {
    if (!finalApiKey) {
      return { ok: false, error: 'API key not set' };
    }
    headers['Authorization'] = `Bearer ${finalApiKey}`;
  }

  const res = await fetch(finalEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: finalModel,
      messages,
      temperature: 0.2
    })
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: text || `Request failed with ${res.status}` };
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { ok: false, error: text || 'Non-JSON response from provider.' };
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Response JSON parse failed.' };
  }
  const content = data?.choices?.[0]?.message?.content || '';
  return { ok: true, content };
}

/**
 * Main entry point: dispatches to the correct provider adapter.
 * Maintains the same signature as the old callOpenAICompatible for backward compatibility.
 */
export async function callOpenAICompatible({ messages, model, endpoint, apiKey }) {
  const provider = resolveProvider(endpoint);

  if (provider === 'anthropic') {
    return callAnthropic({ messages, model, apiKey });
  }

  // For ollama, zai, and openai-compatible, use the OpenAI format
  return callOpenAIFormat({ messages, model, endpoint, apiKey });
}
