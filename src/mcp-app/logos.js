/** @module mcp-app/logos — Model logo SVG registry */

const LOGOS = {
  gemini: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#8E75B2"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>',

  openai: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#ffffff"><path d="M22.28 9.37a6.04 6.04 0 0 0-.52-4.96 6.1 6.1 0 0 0-6.57-2.93A6.06 6.06 0 0 0 10.62 0a6.1 6.1 0 0 0-5.82 4.23 6.04 6.04 0 0 0-4.04 2.93 6.1 6.1 0 0 0 .75 7.15 6.04 6.04 0 0 0 .52 4.96 6.1 6.1 0 0 0 6.57 2.93A6.06 6.06 0 0 0 13.17 24a6.1 6.1 0 0 0 5.82-4.22 6.04 6.04 0 0 0 4.04-2.93 6.1 6.1 0 0 0-.75-7.48z"/></svg>',

  grok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#ffffff"><path d="M2.04 9.88h4.47L13.05 20H8.58L2.04 9.88zm11.52-5.88L16.1 8.16 9.25 20H5.72l7.84-15.99zm4.4 0H22L13.5 20h-4.47l4.93-8.28L10.9 6.08h4.46l2.6 4.39L20 6z"/></svg>',

  llama: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#0081FB"><circle cx="12" cy="12" r="11"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="sans-serif">L</text></svg>',

  deepseek: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#4D6BFE"><circle cx="12" cy="12" r="11"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">DS</text></svg>',
};

const COLORS = {
  gemini: '#8E75B2',
  openai: '#ffffff',
  grok: '#ffffff',
  llama: '#0081FB',
  deepseek: '#4D6BFE',
};

const FALLBACK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#999"><circle cx="12" cy="12" r="11" fill="none" stroke="#999" stroke-width="2"/><text x="12" y="17" text-anchor="middle" fill="#999" font-size="14" font-family="sans-serif">?</text></svg>';

const KNOWN_MODELS = Object.keys(LOGOS);

/** Match a model string to a known provider key. */
function matchProvider(model) {
  if (!model) { return null; }
  const lower = model.toLowerCase();
  if (lower.includes('gemini')) { return 'gemini'; }
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3')) { return 'openai'; }
  if (lower.includes('grok') || lower.includes('xai')) { return 'grok'; }
  if (lower.includes('llama') || lower.includes('meta')) { return 'llama'; }
  if (lower.includes('deepseek')) { return 'deepseek'; }
  return null;
}

function getModelLogo(model) {
  const key = matchProvider(model);
  return key ? LOGOS[key] : FALLBACK_SVG;
}

function getModelColor(model) {
  const key = matchProvider(model);
  return key ? COLORS[key] : '#999999';
}

module.exports = { getModelLogo, getModelColor, matchProvider, KNOWN_MODELS };
