/**
 * Setup UI - Alias Editor Script
 *
 * Returns the inline JS for alias search, inline edit,
 * delete, and add custom alias handlers.
 * Extracted from setup-ui.js to keep file sizes under 300 lines.
 */

/**
 * Build the alias editor JS for inline inclusion in the wizard script
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildAliasScript() {
  return `
  // Alias editor: search
  var aliasSearchInput = $('alias-search');
  if (aliasSearchInput) {
    aliasSearchInput.addEventListener('input', function() {
      var q = this.value.toLowerCase();
      document.querySelectorAll('.alias-group').forEach(function(group) {
        var rows = group.querySelectorAll('.alias-row');
        var anyVisible = false;
        rows.forEach(function(row) {
          var name = row.getAttribute('data-alias') || '';
          var model = (row.querySelector('.alias-model') || {}).textContent || '';
          var match = !q || name.includes(q) || model.toLowerCase().includes(q);
          row.style.display = match ? '' : 'none';
          if (match) { anyVisible = true; }
        });
        group.style.display = anyVisible ? '' : 'none';
        if (q && anyVisible) { group.open = true; }
        if (!q) { group.open = false; }
      });
    });
  }

  // Helper: filter model groups by a keyword (alias name)
  function filterModels(groups, keyword) {
    if (!keyword || !groups || groups.length === 0) { return groups; }
    var kw = keyword.toLowerCase();
    var filtered = [];
    groups.forEach(function(g) {
      var matching = g.models.filter(function(m) {
        return m.id.toLowerCase().includes(kw) || (m.name || '').toLowerCase().includes(kw);
      });
      if (matching.length > 0) {
        filtered.push({ family: g.family, models: matching });
      }
    });
    // Fall back to all models when no matches found
    if (filtered.length === 0) { return groups; }
    return filtered;
  }

  // Helper: build a model <select> dropdown from window.availableModels
  function buildModelSelect(currentValue, cls, filterKeyword) {
    var select = document.createElement('select');
    select.className = cls || 'alias-model-select';
    var groups = filterModels(window.availableModels, filterKeyword);
    if (groups && groups.length > 0) {
      groups.forEach(function(g) {
        var optgroup = document.createElement('optgroup');
        optgroup.label = g.family;
        g.models.forEach(function(m) {
          var opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name || m.id;
          if (m.id === currentValue) { opt.selected = true; }
          optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
      });
    } else {
      // Fallback: flat list from DEFAULT_ALIASES values
      var seen = {};
      Object.values(defaultAliases).forEach(function(v) {
        if (!seen[v]) {
          var opt = document.createElement('option');
          opt.value = v; opt.textContent = v;
          if (v === currentValue) { opt.selected = true; }
          select.appendChild(opt);
          seen[v] = true;
        }
      });
    }
    // If current value not in options, add it
    if (currentValue && !select.querySelector('option[value="' + CSS.escape(currentValue) + '"]')) {
      var custom = document.createElement('option');
      custom.value = currentValue; custom.textContent = currentValue; custom.selected = true;
      select.insertBefore(custom, select.firstChild);
    }
    return select;
  }

  // Alias editor: inline edit
  document.addEventListener('click', function(e) {
    var nameSpan = e.target.closest('.alias-name');
    var modelSpan = e.target.closest('.alias-model');
    var span = nameSpan || modelSpan;
    if (!span) { return; }
    var row = span.closest('.alias-row');
    if (!row || row.classList.contains('alias-deleted')) { return; }
    var isName = !!nameSpan;
    var origValue = span.textContent;
    var origAlias = row.getAttribute('data-alias');

    if (isName) {
      var input = document.createElement('input');
      input.className = 'alias-name-input';
      input.value = origValue;
      span.replaceWith(input);
      input.focus();
      function commitName() {
        var newVal = input.value.trim();
        var newSpan = document.createElement('span');
        newSpan.className = 'alias-name';
        newSpan.textContent = newVal || origValue;
        input.replaceWith(newSpan);
        if (newVal && newVal !== origAlias) {
          aliasEdits[origAlias] = null;
          var modelEl = row.querySelector('.alias-model') || row.querySelector('.alias-model-select');
          var modelVal = modelEl ? (modelEl.value || modelEl.textContent) : '';
          aliasEdits[newVal] = modelVal || defaultAliases[origAlias];
          row.setAttribute('data-alias', newVal);
          var delBtn = row.querySelector('.alias-delete');
          if (delBtn) { delBtn.setAttribute('data-alias', newVal); }
        }
      }
      input.addEventListener('blur', commitName);
      input.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { input.blur(); } });
    } else {
      var select = buildModelSelect(origValue, 'alias-model-select', origAlias);
      span.replaceWith(select);
      select.focus();
      function commitModel() {
        var newVal = select.value;
        var newSpan = document.createElement('span');
        newSpan.className = 'alias-model';
        newSpan.textContent = newVal || origValue;
        select.replaceWith(newSpan);
        if (newVal && newVal !== origValue) {
          aliasEdits[origAlias] = newVal;
        }
      }
      select.addEventListener('change', commitModel);
      select.addEventListener('blur', commitModel);
    }
  });

  // Alias editor: delete
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.alias-delete');
    if (!btn) { return; }
    var alias = btn.getAttribute('data-alias');
    if (!alias) { return; }
    var row = btn.closest('.alias-row');
    if (!row) { return; }
    row.classList.add('alias-deleted');
    if (defaultAliases[alias]) {
      aliasEdits[alias] = null;
    } else {
      delete aliasEdits[alias];
    }
  });

  // Alias editor: add custom shortcut
  var addBtn = $('alias-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      var row = document.createElement('div');
      row.className = 'alias-row';
      var nameInput = document.createElement('input');
      nameInput.className = 'alias-name-input';
      nameInput.placeholder = 'shortcut';
      var arrow = document.createElement('span');
      arrow.className = 'alias-arrow';
      arrow.textContent = '\\u2192';
      var modelSelect = buildModelSelect('', 'alias-model-select');
      var delBtn = document.createElement('button');
      delBtn.className = 'alias-delete';
      delBtn.textContent = '\\u00d7';
      row.appendChild(nameInput);
      row.appendChild(arrow);
      row.appendChild(modelSelect);
      row.appendChild(delBtn);
      var editor = document.querySelector('.alias-editor');
      if (editor) { editor.insertBefore(row, addBtn); }
      nameInput.focus();
      function commitNew() {
        var n = nameInput.value.trim();
        var m = modelSelect.value;
        if (n && m) {
          aliasEdits[n] = m;
          row.setAttribute('data-alias', n);
          var ns = document.createElement('span');
          ns.className = 'alias-name'; ns.textContent = n;
          nameInput.replaceWith(ns);
          var ms = document.createElement('span');
          ms.className = 'alias-model'; ms.textContent = m;
          modelSelect.replaceWith(ms);
          delBtn.setAttribute('data-alias', n);
        }
      }
      modelSelect.addEventListener('change', commitNew);
      nameInput.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { nameInput.blur(); commitNew(); } });
      delBtn.addEventListener('click', function() {
        var a = row.getAttribute('data-alias');
        if (a) { delete aliasEdits[a]; }
        row.remove();
      });
    });
  }`;
}

module.exports = { buildAliasScript };
