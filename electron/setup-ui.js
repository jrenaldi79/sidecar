/** Setup UI - Wizard Orchestrator: API Keys → Models → Aliases → Review */
const { buildKeysStepHTML, PROVIDERS } = require('./setup-ui-keys');
const { buildModelStepHTML, MODEL_CHOICES, PROVIDER_NAMES } = require('./setup-ui-model');
const { buildAliasEditorHTML } = require('./setup-ui-aliases');
const { buildWizardCSS } = require('./setup-ui-styles');
const { buildKeysScript } = require('./setup-ui-keys-script');
const { buildAliasScript } = require('./setup-ui-alias-script');
const { getDefaultAliases } = require('../src/utils/config');

function buildSetupHTML() {
  const keysHtml = buildKeysStepHTML(PROVIDERS);
  const modelHtml = buildModelStepHTML(MODEL_CHOICES);
  const aliasHtml = buildAliasEditorHTML(getDefaultAliases());
  const css = buildWizardCSS();
  const providersJson = JSON.stringify(PROVIDERS);
  const modelChoicesJson = JSON.stringify(MODEL_CHOICES);
  const providerNamesJson = JSON.stringify(PROVIDER_NAMES);
  const defaultAliasesJson = JSON.stringify(getDefaultAliases());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Sidecar Setup</title>
<style>${css}</style></head><body>
  <div class="header"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2v12" stroke="#D97757" stroke-width="2" stroke-linecap="round"/><path d="M10 2v5c0 2-3 3-7 5" stroke="#D97757" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/></svg><span class="header-title">OpenCode Sidecar Setup</span></div>
  <div class="progress-bar"><div class="progress-step active" id="step-1"><span class="progress-dot">1</span><span>API Keys</span></div><div class="progress-connector"></div><div class="progress-step" id="step-2"><span class="progress-dot">2</span><span>Models</span></div><div class="progress-connector"></div><div class="progress-step" id="step-3"><span class="progress-dot">3</span><span>Routing</span></div><div class="progress-connector"></div><div class="progress-step" id="step-4"><span class="progress-dot">4</span><span>Review</span></div></div>
  <div class="content">
    <div class="wizard-step visible" id="wizard-step-1">${keysHtml}</div>
    <div class="wizard-step" id="wizard-step-2">${modelHtml}</div>
    <div class="wizard-step" id="wizard-step-3">${aliasHtml}</div>
    <div class="wizard-step" id="wizard-step-4">
      <div class="step-content">
        <h1>Setup Complete</h1>
        <p class="subtitle">Review your configuration before saving.</p>
        <div class="review-section"><div class="review-label">API Keys</div><div class="review-value" id="review-keys">None configured</div></div>
        <div class="review-section"><div class="review-label">Default Model</div><div class="review-value" id="review-model">Not selected</div></div>
        <div class="review-section"><div class="review-label">Routing</div><div class="review-value" id="review-routing">&mdash;</div></div>
        <div class="review-section"><div class="review-label">Aliases</div><div class="review-value" id="review-aliases">&mdash;</div></div>
      </div>
    </div>
  </div>
  <div class="footer"><div class="footer-brand"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2v12" stroke="#D97757" stroke-width="2" stroke-linecap="round"/><path d="M10 2v5c0 2-3 3-7 5" stroke="#D97757" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/></svg> OpenCode Sidecar</div><div class="footer-nav"><button class="nav-btn" id="back-btn" style="display:none">Back</button><button class="nav-btn primary" id="next-btn" disabled>Next</button><button class="nav-btn primary" id="finish-btn" style="display:none">Finish</button></div></div>
${buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson)}
</body></html>`;
}

function buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson) {
  const keysJs = buildKeysScript();
  const aliasJs = buildAliasScript();
  return `<script>
  window.onerror = function(msg, src, line, col, err) { console.error('WIZARD ERROR:', msg, 'at', src, line, col, err); };
  window.onunhandledrejection = function(e) { console.error('WIZARD UNHANDLED REJECTION:', e.reason); };

  var providers = ${providersJson};
  var currentStep = 1, configuredKeys = {}, keyHints = {};
  var selectedProvider = null;
  var modelChoicesData = ${modelChoicesJson};
  var providerNamesData = ${providerNamesJson};
  var defaultAliases = ${defaultAliasesJson};
  var routingChoices = {};
  var aliasEdits = {};
  window.availableModels = null;
  var keyValid = false, validatedKey = '';
  var $ = function(id) { return document.getElementById(id); };
  var keyInput = $('api-key-input'), testBtn = $('test-btn'), eyeBtn = $('eye-btn');
  var removeBtn = $('remove-btn'), nextBtn = $('next-btn'), backBtn = $('back-btn');
  var finishBtn = $('finish-btn'), statusMsg = $('status-msg');
  var keySection = $('key-section'), keyLabel = $('key-label'), helpLink = $('help-link');

  // Init: load existing keys
  (async function() {
    try {
      var data = await window.sidecarSetup.invoke('sidecar:get-api-keys');
      if (data && data.status) {
        Object.keys(data.status).forEach(function(p) {
          if (data.status[p]) {
            configuredKeys[p] = true;
            var c = document.getElementById('check-' + p);
            if (c) { c.textContent = '\\u2713'; }
          }
        });
        if (data.hints) { keyHints = data.hints; }
        updateNextState();
      }
    } catch (_e) {}
  })();

  // Init: load existing config for model pre-selection and alias edits
  (async function() {
    try {
      var cfg = await window.sidecarSetup.invoke('sidecar:get-config');
      if (cfg && cfg.default) {
        document.querySelectorAll('input[name="default-model"]').forEach(function(r) {
          r.checked = (r.value === cfg.default);
        });
      }
      if (cfg && cfg.aliases) {
        modelChoicesData.forEach(function(mc) {
          var currentModel = cfg.aliases[mc.alias];
          if (currentModel) {
            var provs = Object.keys(mc.routes);
            for (var i = 0; i < provs.length; i++) {
              if (mc.routes[provs[i]] === currentModel) { routingChoices[mc.alias] = provs[i]; break; }
            }
          }
        });
        Object.keys(cfg.aliases).forEach(function(k) {
          if (cfg.aliases[k] !== defaultAliases[k]) { aliasEdits[k] = cfg.aliases[k]; }
        });
        applyAliasEditsToUI();
      }
    } catch (_e) {}
  })();

  function applyAliasEditsToUI() {
    Object.keys(aliasEdits).forEach(function(k) {
      var row = document.querySelector('.alias-row[data-alias="' + k + '"]');
      if (!row) { return; }
      if (aliasEdits[k] === null) { row.classList.add('alias-deleted'); return; }
      var modelSpan = row.querySelector('.alias-model');
      if (modelSpan) { modelSpan.textContent = aliasEdits[k]; }
    });
  }

  function showStep(step) {
    currentStep = step;
    [1, 2, 3, 4].forEach(function(s) {
      document.getElementById('wizard-step-' + s).classList.toggle('visible', s === step);
      var prog = document.getElementById('step-' + s);
      prog.classList.remove('active', 'done');
      if (s < step) { prog.classList.add('done'); }
      if (s === step) { prog.classList.add('active'); }
    });
    backBtn.style.display = step > 1 ? '' : 'none';
    nextBtn.style.display = step < 4 ? '' : 'none';
    finishBtn.style.display = step === 4 ? '' : 'none';
    if (step === 4) { buildReview(); }
    if (step === 2) { updateRoutingPills(); }
    if (step === 3 && !window.availableModels) { fetchAvailableModels(); }
    updateNextState();
  }

  function updateNextState() {
    if (currentStep === 1) {
      nextBtn.disabled = !Object.values(configuredKeys).some(function(v) { return v; });
    } else { nextBtn.disabled = false; }
  }

  function updateRoutingPills() {
    modelChoicesData.forEach(function(mc) {
      var provs = Object.keys(mc.routes);
      if (provs.length < 2) { return; }
      var available = provs.filter(function(p) { return configuredKeys[p]; });
      var toggle = document.querySelector('.route-toggle[data-alias="' + mc.alias + '"]');
      var staticEl = document.querySelector('.route-static[data-alias="' + mc.alias + '"]');
      if (!toggle) { return; }
      if (available.length >= 2) {
        toggle.style.display = 'flex';
        if (staticEl) { staticEl.style.display = 'none'; }
      } else {
        toggle.style.display = 'none';
        if (staticEl) { staticEl.style.display = ''; }
      }
      var selected = routingChoices[mc.alias] || 'openrouter';
      toggle.querySelectorAll('.route-pill').forEach(function(pill) {
        pill.classList.toggle('active', pill.getAttribute('data-provider') === selected);
      });
    });
  }

  function buildReview() {
    var kn = Object.keys(configuredKeys).filter(function(k) { return configuredKeys[k]; });
    document.getElementById('review-keys').textContent =
      kn.length > 0 ? kn.map(function(k) { return k + ' \\u2713'; }).join(', ') : 'None';
    var r = document.querySelector('input[name="default-model"]:checked');
    document.getElementById('review-model').textContent = r ? r.value : 'Not selected';
    var routeLines = [];
    modelChoicesData.forEach(function(mc) {
      var prov = routingChoices[mc.alias] || 'openrouter';
      var provName = providerNamesData[prov] || prov;
      routeLines.push(mc.alias + ' \\u2192 ' + provName);
    });
    document.getElementById('review-routing').textContent = routeLines.join(', ');
    var editCount = Object.keys(aliasEdits).length;
    var reviewAliases = document.getElementById('review-aliases');
    if (reviewAliases) {
      reviewAliases.textContent = editCount > 0 ? editCount + ' alias(es) modified' : 'No changes';
    }
  }

  nextBtn.addEventListener('click', function() { if (currentStep < 4) { showStep(currentStep + 1); } });
  backBtn.addEventListener('click', function() { if (currentStep > 1) { showStep(currentStep - 1); } });

  // Route pill click handler
  document.addEventListener('click', function(e) {
    var pill = e.target.closest('.route-pill');
    if (!pill) { return; }
    var alias = pill.getAttribute('data-alias');
    var provider = pill.getAttribute('data-provider');
    if (!alias || !provider) { return; }
    routingChoices[alias] = provider;
    var toggle = pill.parentElement;
    toggle.querySelectorAll('.route-pill').forEach(function(p) { p.classList.toggle('active', p === pill); });
  });

  finishBtn.addEventListener('click', async function() {
    finishBtn.disabled = true; finishBtn.textContent = 'Saving...';
    try {
      var r = document.querySelector('input[name="default-model"]:checked');
      var dm = r ? r.value : 'gemini';
      var routingOverrides = {};
      modelChoicesData.forEach(function(mc) {
        var prov = routingChoices[mc.alias] || 'openrouter';
        routingOverrides[mc.alias] = mc.routes[prov];
      });
      Object.keys(aliasEdits).forEach(function(k) {
        routingOverrides[k] = aliasEdits[k];
      });
      await window.sidecarSetup.invoke('sidecar:save-config', dm, routingOverrides);
      var kc = Object.values(configuredKeys).filter(function(v) { return v; }).length;
      await window.sidecarSetup.invoke('sidecar:setup-done', dm, kc);
    } catch (_e) { finishBtn.disabled = false; finishBtn.textContent = 'Finish'; }
  });

  async function fetchAvailableModels() {
    try {
      var groups = await window.sidecarSetup.invoke('sidecar:fetch-models');
      if (groups && groups.length > 0) { window.availableModels = groups; }
    } catch (_e) {}
  }

  ${aliasJs}

  ${keysJs}
</script>`;
}

module.exports = { buildSetupHTML, PROVIDERS };
