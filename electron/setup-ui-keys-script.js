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
  });

  // Custom provider form logic
  var cpForm = document.getElementById('custom-provider-form');
  var cpStatusMsg = document.getElementById('cp-status-msg');
  document.getElementById('add-custom-btn').addEventListener('click', function() {
    cpForm.style.display = cpForm.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('cp-cancel-btn').addEventListener('click', function() {
    cpForm.style.display = 'none'; cpStatusMsg.textContent = '';
  });
  document.getElementById('cp-save-btn').addEventListener('click', async function() {
    var cpId = document.getElementById('cp-id').value.trim().toLowerCase();
    var cpName = document.getElementById('cp-name').value.trim();
    var cpUrl = document.getElementById('cp-url').value.trim();
    var cpAuth = document.getElementById('cp-auth').value;
    var cpEnv = document.getElementById('cp-env').value.trim() || (cpId.toUpperCase() + '_API_KEY');
    if (!cpId || !cpName || !cpUrl) {
      cpStatusMsg.textContent = 'ID, Name, and Base URL are required';
      cpStatusMsg.className = 'status-invalid'; return;
    }
    try {
      await window.sidecarSetup.invoke('sidecar:save-custom-provider', cpId, { name: cpName, baseUrl: cpUrl, authType: cpAuth, envVar: cpEnv });
      var newProv = { id: cpId, name: cpName, description: cpUrl, placeholder: '', custom: true };
      providers.push(newProv);
      addCustomProviderCard(newProv);
      cpForm.style.display = 'none'; cpStatusMsg.textContent = '';
      document.getElementById('cp-id').value = '';
      document.getElementById('cp-name').value = '';
      document.getElementById('cp-url').value = '';
      document.getElementById('cp-env').value = '';
    } catch (e) {
      cpStatusMsg.textContent = e.message || 'Failed to save'; cpStatusMsg.className = 'status-invalid';
    }
  });

  function addCustomProviderCard(prov) {
    var list = document.getElementById('custom-providers-list');
    var btn = document.createElement('button');
    btn.className = 'provider-btn'; btn.setAttribute('data-provider', prov.id);
    btn.innerHTML = '<span class="provider-name">' + prov.name + ' <span class="badge">Custom</span></span>' +
      '<span class="provider-desc">' + prov.description + '</span>' +
      '<span class="provider-check" id="check-' + prov.id + '"></span>';
    btn.addEventListener('click', function() {
      selectedProvider = prov;
      document.querySelectorAll('.provider-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      keySection.classList.add('visible');
      keyLabel.textContent = prov.name + ' API Key';
      keyInput.placeholder = prov.placeholder || '';
      if (keyHints[prov.id]) {
        keyInput.value = keyHints[prov.id]; keyInput.type = 'text'; keyValid = false;
        setInputState('valid'); statusMsg.textContent = 'Key configured \\u2714'; statusMsg.className = 'status-valid';
        removeBtn.style.display = '';
      } else {
        keyInput.value = ''; keyInput.type = 'password'; keyValid = false; setInputState(null);
        statusMsg.textContent = ''; statusMsg.className = ''; removeBtn.style.display = 'none';
      }
      eyeBtn.classList.remove('active'); keyInput.focus();
      helpLink.textContent = '';
    });
    list.appendChild(btn);
  }

  // Load existing custom providers on init
  (async function() {
    try {
      var custom = await window.sidecarSetup.invoke('sidecar:get-custom-providers');
      if (custom) {
        Object.keys(custom).forEach(function(id) {
          var cp = custom[id];
          var prov = { id: id, name: cp.name, description: cp.baseUrl, placeholder: '', custom: true };
          providers.push(prov);
          addCustomProviderCard(prov);
        });
      }
    } catch (_e) {}
  })();`;
}

module.exports = { buildKeysScript };
