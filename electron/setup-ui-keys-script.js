/**
 * Setup UI - Step 1 Key Management Script
 *
 * Returns the inline JS for provider selection, key input,
 * test/save, eye toggle, and remove handlers.
 * Extracted from setup-ui.js to keep file sizes under 300 lines.
 */

/**
 * Build the key management JS for inline inclusion in the wizard script
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildKeysScript() {
  return `
  // Step 1: Provider selection & key management
  document.querySelectorAll('.provider-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = this.getAttribute('data-provider');
      var prov = providers.find(function(p) { return p.id === id; });
      if (!prov) { return; }
      selectedProvider = prov;
      document.querySelectorAll('.provider-btn').forEach(function(b) { b.classList.remove('selected'); });
      this.classList.add('selected');
      keySection.classList.add('visible');
      keyLabel.textContent = prov.name + ' API Key';
      keyInput.placeholder = prov.placeholder;
      if (keyHints[prov.id]) {
        keyInput.value = keyHints[prov.id]; keyInput.type = 'text'; keyValid = false;
        setInputState('valid');
        statusMsg.textContent = 'Key configured \\u2714'; statusMsg.className = 'status-valid';
        removeBtn.style.display = '';
      } else {
        keyInput.value = ''; keyInput.type = 'password'; keyValid = false;
        setInputState(null);
        statusMsg.textContent = ''; statusMsg.className = '';
        removeBtn.style.display = 'none';
      }
      eyeBtn.classList.remove('active'); keyInput.focus();
      var a = document.createElement('a');
      a.href = prov.helpUrl; a.textContent = prov.helpLabel;
      helpLink.textContent = "Don't have a key? Get one at ";
      helpLink.appendChild(a);
      a.addEventListener('click', function(e) {
        e.preventDefault();
        if (window.sidecarSetup && window.sidecarSetup.openExternal) { window.sidecarSetup.openExternal(this.href); }
      });
    });
  });

  function setInputState(state) {
    keyInput.classList.remove('input-valid', 'input-invalid', 'input-testing');
    if (state) { keyInput.classList.add('input-' + state); }
  }

  testBtn.addEventListener('click', async function() {
    if (!selectedProvider) { return; }
    var key = keyInput.value.trim();
    if (!key) {
      statusMsg.textContent = 'Please enter an API key'; statusMsg.className = 'status-invalid';
      setInputState('invalid'); return;
    }
    testBtn.disabled = true; testBtn.textContent = 'Testing...';
    statusMsg.textContent = ''; statusMsg.className = ''; setInputState('testing');
    try {
      var res = await window.sidecarSetup.invoke('sidecar:validate-key', selectedProvider.id, key);
      if (res.valid) {
        await window.sidecarSetup.invoke('sidecar:save-key', selectedProvider.id, key);
        configuredKeys[selectedProvider.id] = true;
        var c = document.getElementById('check-' + selectedProvider.id);
        if (c) { c.textContent = '\\u2713'; }
        statusMsg.textContent = 'Saved \\u2713'; statusMsg.className = 'status-valid';
        setInputState('valid'); keyValid = true; validatedKey = key;
        keyHints[selectedProvider.id] = key.slice(0, 8) + '\\u2022'.repeat(Math.min(key.length - 8, 12));
        removeBtn.style.display = ''; updateNextState();
      } else {
        statusMsg.textContent = res.error || 'Invalid key'; statusMsg.className = 'status-invalid';
        setInputState('invalid'); keyValid = false;
      }
    } catch (_e) {
      statusMsg.textContent = 'Connection failed'; statusMsg.className = 'status-invalid';
      setInputState('invalid'); keyValid = false;
    }
    testBtn.disabled = false; testBtn.textContent = 'Save \\u0026 Test';
  });

  keyInput.addEventListener('input', function() {
    if (keyInput.type === 'text') { keyInput.type = 'password'; }
    if (keyValid && keyInput.value.trim() !== validatedKey) { keyValid = false; statusMsg.textContent = ''; setInputState(null); }
    if (!keyInput.value.trim()) { statusMsg.textContent = ''; statusMsg.className = ''; setInputState(null); }
  });
  keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { testBtn.click(); } });

  eyeBtn.addEventListener('click', function() {
    if (keyInput.type === 'password') { keyInput.type = 'text'; eyeBtn.classList.add('active'); }
    else { keyInput.type = 'password'; eyeBtn.classList.remove('active'); }
    keyInput.focus();
  });

  removeBtn.addEventListener('click', async function() {
    if (!selectedProvider) { return; }
    removeBtn.disabled = true;
    try {
      await window.sidecarSetup.invoke('sidecar:remove-key', selectedProvider.id);
      delete configuredKeys[selectedProvider.id]; delete keyHints[selectedProvider.id];
      var c = document.getElementById('check-' + selectedProvider.id);
      if (c) { c.textContent = ''; }
      keyInput.value = ''; keyInput.type = 'password'; keyValid = false; setInputState(null);
      statusMsg.textContent = 'Key removed'; statusMsg.className = 'status-testing';
      removeBtn.style.display = 'none'; updateNextState();
    } catch (_e) { statusMsg.textContent = 'Failed to remove'; statusMsg.className = 'status-invalid'; }
    removeBtn.disabled = false;
  });`;
}

module.exports = { buildKeysScript };
