/**
 * Autocomplete Manager Module
 *
 * Provides unified autocomplete functionality with pluggable providers.
 * Handles trigger detection, dropdown rendering, and keyboard navigation.
 *
 * Usage:
 *   const manager = new AutocompleteManager({
 *     inputElement: document.getElementById('message-input'),
 *     containerElement: document.getElementById('input-wrapper'),
 *     providers: [fileProvider, commandProvider]
 *   });
 *   manager.init();
 */

/**
 * Detect trigger character in text at cursor position
 * @param {string} text - The input text
 * @param {number} cursorPos - Current cursor position
 * @returns {{trigger: string, query: string, startPos: number}|null}
 */
function detectTrigger(text, cursorPos) {
  if (!text || cursorPos === 0) {
    return null;
  }

  // Look backwards from cursor to find a trigger character
  let triggerPos = -1;
  let trigger = null;

  for (let i = cursorPos - 1; i >= 0; i--) {
    const char = text[i];

    // Stop at whitespace or newline - trigger must be after space or at start
    if (char === ' ' || char === '\n' || char === '\t') {
      break;
    }

    // Check for @ trigger (always valid at start of word, can have / in query for file paths)
    if (char === '@') {
      // Verify @ is at start of word (after space, newline, or at position 0)
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\t') {
        triggerPos = i;
        trigger = char;
      }
      break;
    }

    // Check for / trigger (only valid at start of word, not in middle of path)
    if (char === '/') {
      // Verify / is at start of word (after space, newline, or at position 0)
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\t') {
        triggerPos = i;
        trigger = char;
        break;
      }
      // If / is not at start of word, it's part of a path - continue looking for @
      continue;
    }
  }

  if (triggerPos === -1 || !trigger) {
    return null;
  }

  // Extract the query (text between trigger and cursor)
  const query = text.slice(triggerPos + 1, cursorPos);

  return {
    trigger,
    query,
    startPos: triggerPos
  };
}

/**
 * Autocomplete Manager Class
 */
class AutocompleteManager {
  /**
   * @param {Object} config
   * @param {HTMLTextAreaElement} config.inputElement - The textarea to attach to
   * @param {HTMLElement} config.containerElement - Parent container for dropdown positioning
   * @param {Array} config.providers - Array of autocomplete providers
   */
  constructor(config) {
    this._input = config.inputElement;
    this._container = config.containerElement;
    this._providers = config.providers || [];

    // State
    this._dropdown = null;
    this._items = [];
    this._highlightedIndex = 0;
    this._activeProvider = null;
    this._triggerInfo = null;
    this._debounceTimer = null;

    // Bound handlers for cleanup
    this._boundHandlers = {
      onInput: this._handleInput.bind(this),
      onKeyDown: this._handleKeyDown.bind(this),
      onBlur: this._handleBlur.bind(this)
    };
  }

  /**
   * Initialize the manager and attach event listeners
   */
  init() {
    this._input.addEventListener('input', this._boundHandlers.onInput);
    this._input.addEventListener('keydown', this._boundHandlers.onKeyDown);
    this._input.addEventListener('blur', this._boundHandlers.onBlur);
  }

  /**
   * Destroy the manager and clean up event listeners
   */
  destroy() {
    this._input.removeEventListener('input', this._boundHandlers.onInput);
    this._input.removeEventListener('keydown', this._boundHandlers.onKeyDown);
    this._input.removeEventListener('blur', this._boundHandlers.onBlur);
    this.hide();
  }

  /**
   * Check if autocomplete dropdown is currently visible
   * @returns {boolean}
   */
  isActive() {
    return this._dropdown !== null && this._items.length > 0;
  }

  /**
   * Hide the autocomplete dropdown
   */
  hide() {
    if (this._dropdown && this._dropdown.parentNode) {
      this._dropdown.parentNode.removeChild(this._dropdown);
    }
    this._dropdown = null;
    this._items = [];
    this._highlightedIndex = 0;
    this._activeProvider = null;
    this._triggerInfo = null;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * Register a new provider
   * @param {Object} provider
   */
  registerProvider(provider) {
    this._providers.push(provider);
  }

  /**
   * Handle input events
   * @private
   */
  _handleInput() {
    const text = this._input.value;
    const cursorPos = this._input.selectionStart;

    // Detect trigger
    const triggerInfo = detectTrigger(text, cursorPos);

    if (!triggerInfo) {
      this.hide();
      return;
    }

    // Find matching provider
    const provider = this._providers.find(p => p.trigger === triggerInfo.trigger);
    if (!provider) {
      this.hide();
      return;
    }

    // Check minimum characters
    const minChars = provider.minChars || 0;
    if (triggerInfo.query.length < minChars) {
      this.hide();
      return;
    }

    // Store state
    this._activeProvider = provider;
    this._triggerInfo = triggerInfo;

    // Debounce search
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    const debounceMs = provider.debounceMs || 150;
    this._debounceTimer = setTimeout(async () => {
      try {
        const items = await provider.search(triggerInfo.query);
        if (items && items.length > 0) {
          await this._showDropdown(items);
        } else {
          this.hide();
        }
      } catch (err) {
        console.error('[Autocomplete] Search error:', err);
        this.hide();
      }
    }, debounceMs);
  }

  /**
   * Handle keydown events
   * @private
   */
  _handleKeyDown(event) {
    if (!this.isActive()) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this._highlightedIndex = (this._highlightedIndex + 1) % this._items.length;
        this._updateHighlight();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this._highlightedIndex = (this._highlightedIndex - 1 + this._items.length) % this._items.length;
        this._updateHighlight();
        break;

      case 'Tab':
      case 'Enter':
        if (this._items.length > 0) {
          event.preventDefault();
          this._selectItem(this._items[this._highlightedIndex]);
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.hide();
        break;
    }
  }

  /**
   * Handle blur events
   * @private
   */
  _handleBlur() {
    // Delay hide to allow click on dropdown item
    setTimeout(() => {
      if (!this._container.contains(document.activeElement)) {
        this.hide();
      }
    }, 150);
  }

  /**
   * Show dropdown with items
   * @private
   */
  async _showDropdown(items) {
    this._items = items;
    this._highlightedIndex = 0;

    // Create dropdown if it doesn't exist
    if (!this._dropdown) {
      this._dropdown = document.createElement('div');
      this._dropdown.className = 'autocomplete-dropdown';
      this._container.appendChild(this._dropdown);
    }

    // Position dropdown above input
    this._positionDropdown();

    // Render items using safe DOM methods
    this._renderItems();
  }

  /**
   * Position dropdown above the input
   * @private
   */
  _positionDropdown() {
    if (!this._dropdown) return;

    const containerRect = this._container.getBoundingClientRect();

    // Position above input
    this._dropdown.style.position = 'absolute';
    this._dropdown.style.bottom = `${containerRect.height}px`;
    this._dropdown.style.left = '0';
    this._dropdown.style.right = '0';
  }

  /**
   * Render items in dropdown using safe DOM methods
   * @private
   */
  _renderItems() {
    if (!this._dropdown) return;

    // Clear existing content
    this._dropdown.textContent = '';

    // Group items by category if available
    const grouped = {};
    this._items.forEach((item, index) => {
      const category = item.category || 'default';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push({ ...item, _index: index });
    });

    // Build DOM elements
    const categoryOrder = ['builtin', 'subagent', 'custom', 'default'];

    categoryOrder.forEach(category => {
      const items = grouped[category];
      if (!items || items.length === 0) return;

      // Add category header for commands
      if (category !== 'default' && this._activeProvider?.trigger === '/') {
        const categoryName = category === 'builtin' ? 'Commands' :
          category === 'subagent' ? 'Subagents' :
            category === 'custom' ? 'Custom' : '';
        if (categoryName) {
          const header = document.createElement('div');
          header.className = 'autocomplete-category';
          header.textContent = categoryName;
          this._dropdown.appendChild(header);
        }
      }

      items.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'autocomplete-item' + (item._index === this._highlightedIndex ? ' highlighted' : '');
        itemEl.dataset.index = item._index;
        itemEl.dataset.type = item.category || (this._activeProvider?.trigger === '@' ? 'file' : 'command');

        // Add icon if present (icon is SVG from our own code, safe to use)
        if (item.icon) {
          const iconEl = document.createElement('span');
          iconEl.className = 'autocomplete-item-icon';
          // SVG icons are generated by our code (file-autocomplete.js, command-autocomplete.js)
          // so they are safe - they contain only static SVG markup we control
          iconEl.innerHTML = item.icon;
          itemEl.appendChild(iconEl);
        }

        // Content container
        const contentEl = document.createElement('div');
        contentEl.className = 'autocomplete-item-content';

        // Label (text content - safe)
        const labelEl = document.createElement('div');
        labelEl.className = 'autocomplete-item-label';
        labelEl.textContent = item.label;
        contentEl.appendChild(labelEl);

        // Description if present (text content - safe)
        if (item.description) {
          const descEl = document.createElement('div');
          descEl.className = 'autocomplete-item-description';
          descEl.textContent = item.description;
          contentEl.appendChild(descEl);
        }

        itemEl.appendChild(contentEl);

        // Click handler
        itemEl.addEventListener('click', () => {
          this._selectItem(this._items[item._index]);
        });

        // Hover handler
        itemEl.addEventListener('mouseenter', () => {
          this._highlightedIndex = item._index;
          this._updateHighlight();
        });

        this._dropdown.appendChild(itemEl);
      });
    });

    // Add keyboard hints
    const hintEl = document.createElement('div');
    hintEl.className = 'autocomplete-hint';

    const upDown = document.createElement('span');
    const kbd1 = document.createElement('kbd');
    kbd1.textContent = '↑';
    const kbd2 = document.createElement('kbd');
    kbd2.textContent = '↓';
    upDown.appendChild(kbd1);
    upDown.appendChild(kbd2);
    upDown.appendChild(document.createTextNode(' navigate '));
    hintEl.appendChild(upDown);

    const tabHint = document.createElement('span');
    const kbd3 = document.createElement('kbd');
    kbd3.textContent = 'Tab';
    tabHint.appendChild(kbd3);
    tabHint.appendChild(document.createTextNode(' select '));
    hintEl.appendChild(tabHint);

    const escHint = document.createElement('span');
    const kbd4 = document.createElement('kbd');
    kbd4.textContent = 'Esc';
    escHint.appendChild(kbd4);
    escHint.appendChild(document.createTextNode(' close'));
    hintEl.appendChild(escHint);

    this._dropdown.appendChild(hintEl);
  }

  /**
   * Update highlight in dropdown
   * @private
   */
  _updateHighlight() {
    if (!this._dropdown) return;

    this._dropdown.querySelectorAll('.autocomplete-item').forEach((el) => {
      if (parseInt(el.dataset.index, 10) === this._highlightedIndex) {
        el.classList.add('highlighted');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('highlighted');
      }
    });
  }

  /**
   * Select an item and insert text
   * @private
   */
  _selectItem(item) {
    if (!this._activeProvider || !this._triggerInfo) {
      this.hide();
      return;
    }

    const insertText = this._activeProvider.getInsertText(item, this._triggerInfo.query);
    const startPos = this._triggerInfo.startPos;
    const endPos = this._input.selectionStart;

    this._insertText(insertText, startPos, endPos);
    this.hide();
    this._input.focus();
  }

  /**
   * Insert text into input
   * @private
   */
  _insertText(text, startPos, endPos) {
    const before = this._input.value.substring(0, startPos);
    const after = this._input.value.substring(endPos);

    this._input.value = before + text + after;

    // Position cursor after inserted text
    const newPos = startPos + text.length;
    this._input.selectionStart = newPos;
    this._input.selectionEnd = newPos;

    // Dispatch input event for any listeners
    if (this._input.dispatchEvent) {
      this._input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// Export for both browser and Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AutocompleteManager,
    detectTrigger
  };
}

// Browser global
if (typeof window !== 'undefined') {
  window.Autocomplete = {
    AutocompleteManager,
    detectTrigger
  };
}
