const DICT = {
  llm_error: 'LLM is not configured or the call failed: {{error}}. You can set the API Key/Endpoint in the UI or configure MANUSCRIPTA_LLM_* environment variables.',
  missing_project_id_tools: 'Missing projectId; tools mode is unavailable.',
  zip_extract_failed: 'Zip extraction failed: {{error}}',
  arxiv_download_failed: 'arXiv download failed: {{error}}'
};

export function getLang() {
  return 'en-US';
}

export function t(_lang, key, params = {}) {
  const template = DICT[key] || key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, token) => {
    const value = params[token];
    return value === undefined || value === null ? '' : String(value);
  });
}
