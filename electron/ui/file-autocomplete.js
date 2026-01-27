/**
 * File Autocomplete Provider Module
 *
 * Provides @ file autocomplete functionality using OpenCode's find/file API.
 * Filters results, formats file paths, and provides file type icons.
 *
 * Usage:
 *   const provider = createFileAutocompleteProvider({
 *     apiBase: 'http://localhost:4096',
 *     maxResults: 10
 *   });
 */

/**
 * Default patterns to exclude from file search results
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '__pycache__',
  '.DS_Store'
];

/**
 * File extension to icon mapping
 * Returns SVG icon markup for common file types
 */
const FILE_ICONS = {
  js: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f7df1e" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  ts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3178c6" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  jsx: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#61dafb" stroke-width="2"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4"/></svg>',
  tsx: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#61dafb" stroke-width="2"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4"/></svg>',
  json: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbcb41" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  md: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#519aba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  css: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#563d7c" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e34c26" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  py: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3776ab" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>',
  default: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'
};

/**
 * Get file icon SVG based on file extension
 * @param {string} filename - The filename to get icon for
 * @returns {string} SVG markup for the file icon
 */
function getFileIcon(filename) {
  if (!filename) {
    return FILE_ICONS.default;
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

/**
 * Check if a file path should be excluded
 * @param {string} path - File path to check
 * @param {string[]} patterns - Patterns to exclude
 * @returns {boolean} True if path should be excluded
 */
function shouldExclude(path, patterns) {
  return patterns.some(pattern => path.includes(pattern));
}

/**
 * Create a file autocomplete provider
 * @param {Object} config - Provider configuration
 * @param {string} config.apiBase - Base URL for OpenCode API (e.g., 'http://localhost:4096')
 * @param {number} [config.maxResults=10] - Maximum number of results to return
 * @param {string[]} [config.excludePatterns] - Patterns to exclude from results
 * @param {number} [config.debounceMs=200] - Debounce delay in milliseconds
 * @returns {Object} Autocomplete provider
 */
function createFileAutocompleteProvider(config) {
  const {
    apiBase,
    maxResults = 10,
    excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
    debounceMs = 200
  } = config;

  return {
    trigger: '@',
    name: 'file',
    debounceMs,
    minChars: 0,

    /**
     * Search for files matching the query
     * @param {string} query - Search query
     * @returns {Promise<Array>} Array of matching file items
     */
    async search(query) {
      try {
        const url = `${apiBase}/find/file?query=${encodeURIComponent(query)}&limit=${maxResults}`;
        const response = await fetch(url);

        if (!response.ok) {
          console.error('[FileAutocomplete] API error:', response.status);
          return [];
        }

        const data = await response.json();
        const files = data.files || [];

        // Filter excluded patterns
        const filtered = files.filter(file => !shouldExclude(file.path, excludePatterns));

        // Limit results
        const limited = filtered.slice(0, maxResults);

        // Format for autocomplete
        return limited.map(file => ({
          id: file.path,
          label: file.name,
          description: file.path,
          icon: getFileIcon(file.name),
          category: 'file'
        }));
      } catch (err) {
        console.error('[FileAutocomplete] Search error:', err);
        return [];
      }
    },

    /**
     * Get the text to insert when item is selected
     * @param {Object} item - Selected item
     * @param {string} _query - Original query (unused)
     * @returns {string} Text to insert
     */
    getInsertText(item, _query) {
      return `@${item.id} `;
    }
  };
}

// Export for both browser and Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createFileAutocompleteProvider,
    DEFAULT_EXCLUDE_PATTERNS,
    getFileIcon,
    shouldExclude
  };
}

// Browser global
if (typeof window !== 'undefined') {
  window.FileAutocomplete = {
    createFileAutocompleteProvider,
    DEFAULT_EXCLUDE_PATTERNS,
    getFileIcon
  };
}
