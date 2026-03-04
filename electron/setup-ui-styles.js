/** Setup UI - Shared CSS Styles */
function buildWizardCSS() {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #2D2B2A; color: #E8E0D8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column; height: 100vh; user-select: none;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 20px; border-bottom: 1px solid #3D3A38;
  }
  .header svg { flex-shrink: 0; }
  .header-title {
    color: #D97757; font-size: 12px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
  }

  /* Progress bar */
  .progress-bar {
    display: flex; align-items: center; justify-content: center;
    gap: 14px; padding: 10px 20px; border-bottom: 1px solid #3D3A38;
  }
  .progress-step {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: #7A756F;
  }
  .progress-step.active { color: #D97757; }
  .progress-step.done { color: #6BBF6B; }
  .progress-dot {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #5A5550; display: flex;
    align-items: center; justify-content: center;
    font-size: 9px; font-weight: 600;
  }
  .progress-step.active .progress-dot {
    border-color: #D97757; background: #D97757; color: #fff;
  }
  .progress-step.done .progress-dot {
    border-color: #6BBF6B; background: #6BBF6B; color: #fff;
  }
  .progress-connector { width: 24px; height: 2px; background: #3D3A38; }

  /* Content area */
  .content { flex: 1; padding: 16px 20px; overflow-y: auto; }
  .wizard-step { display: none; }
  .wizard-step.visible { display: block; }

  /* Shared typography */
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; color: #E8E0D8; }
  .subtitle { color: #A09B96; font-size: 13px; margin-bottom: 14px; }

  /* Provider picker (Step 1) */
  .provider-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .provider-btn {
    display: flex; flex-direction: column; gap: 1px; position: relative;
    padding: 8px 12px; background: #1E1C1B; border: 1px solid #3D3A38;
    border-radius: 6px; cursor: pointer; text-align: left; transition: all 0.15s;
  }
  .provider-btn:hover { border-color: #5A5550; }  .provider-btn.selected { border-color: #D97757; background: #352E2B; }
  .provider-name {
    color: #E8E0D8; font-size: 13px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
  }
  .provider-desc { color: #7A756F; font-size: 11px; }
  .provider-check { position: absolute; top: 8px; right: 12px; font-size: 13px; color: #6BBF6B; }
  .badge {
    font-size: 9px; background: #D97757; color: #fff; padding: 1px 5px;
    border-radius: 3px; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Key input (Step 1) */
  .key-section { display: none; }
  .key-section.visible { display: block; }
  .field-label {
    display: block; color: #A09B96; font-size: 11px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .input-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .input-row input {
    flex: 1; padding: 7px 10px; background: #1E1C1B; border: 1px solid #3D3A38;
    border-radius: 6px; color: #E8E0D8; font-size: 13px;
    font-family: 'SF Mono', Menlo, Monaco, monospace; outline: none;
    transition: border-color 0.15s;
  }
  .input-row input:focus { border-color: #D97757; }
  .input-row input::placeholder { color: #5A5550; }
  .input-wrap {
    flex: 1; position: relative; display: flex; align-items: center;
  }
  .input-wrap input { width: 100%; padding-right: 34px; }
  .eye-btn {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: #5A5550;
    padding: 2px; display: flex; align-items: center; transition: color 0.15s;
  }
  .eye-btn:hover { color: #A09B96; }
  .eye-btn.active { color: #D97757; }
  .key-actions {
    display: flex; align-items: center; justify-content: space-between;
    min-height: 18px; margin-bottom: 8px;
  }
  .remove-btn {
    background: none; border: none; color: #E05252; font-size: 11px;
    cursor: pointer; padding: 0; opacity: 0.8; transition: opacity 0.15s;
  }
  .remove-btn:hover { opacity: 1; text-decoration: underline; }
  .test-btn {
    padding: 7px 12px; background: transparent; border: 1px solid #3D3A38;
    border-radius: 6px; color: #A09B96; font-size: 12px; cursor: pointer;
    white-space: nowrap; transition: all 0.15s;
  }
  .test-btn:hover { border-color: #D97757; color: #D97757; }
  .test-btn:disabled { opacity: 0.5; cursor: default; }
  .input-row input.input-valid {
    border-color: #6BBF6B; background: #1E2B1E;
  }
  .input-row input.input-invalid {
    border-color: #E05252; background: #2B1E1E;
  }
  .input-row input.input-testing {
    border-color: #D97757;
  }
  #status-msg { font-size: 12px; min-height: 16px; margin-bottom: 8px; }
  .status-valid { color: #6BBF6B; }
  .status-invalid { color: #E05252; }
  .status-testing { color: #A09B96; }
  .help-link { color: #7A756F; font-size: 12px; }
  .help-link a { color: #D97757; text-decoration: none; }
  .help-link a:hover { text-decoration: underline; }

  /* Model cards (Step 2) */
  .model-list { display: flex; flex-direction: column; gap: 4px; }
  .model-card {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 9px 12px; background: #1E1C1B; border: 1px solid #3D3A38;
    border-radius: 6px; cursor: pointer; transition: all 0.15s;
  }
  .model-card:hover { border-color: #5A5550; }
  .model-card:has(input:checked) { border-color: #D97757; background: #352E2B; }
  .model-card input[type="radio"] { accent-color: #D97757; }
  .model-alias { color: #E8E0D8; font-weight: 500; font-size: 13px; min-width: 80px; }
  .model-label { color: #A09B96; font-size: 12px; }

  /* Route toggle (Step 2) */
  .route-toggle {
    display: flex; gap: 0; margin-left: auto;
  }
  .route-pill {
    padding: 3px 8px; font-size: 10px; font-weight: 500;
    background: #1E1C1B; border: 1px solid #3D3A38;
    color: #7A756F; cursor: pointer; transition: all 0.15s;
  }
  .route-pill:first-child { border-radius: 4px 0 0 4px; }
  .route-pill:last-child { border-radius: 0 4px 4px 0; border-left: none; }
  .route-pill:only-child { border-radius: 4px; }
  .route-pill.active {
    background: #D97757; color: #fff; border-color: #D97757;
  }
  .route-pill:hover:not(.active) { border-color: #5A5550; color: #A09B96; }
  .route-static {
    margin-left: auto; font-size: 11px; color: #5A5550; font-style: italic;
  }

  /* Routing example */
  .routing-example {
    background: #1E1C1B; border: 1px solid #3D3A38; border-radius: 8px;
    padding: 12px 16px; margin-bottom: 12px;
  }
  .example-label {
    font-size: 10px; color: #5A5550; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 10px; font-weight: 600;
  }
  .example-flow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .example-step {
    display: flex; align-items: center; gap: 6px; width: 100%;
    background: #2D2B2A; border: 1px solid #3D3A38;
    border-radius: 6px; padding: 6px 10px;
  }
  .example-step svg { flex-shrink: 0; }
  .example-connector { display: flex; align-items: center; transform: rotate(90deg); }
  .example-cmd {
    font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 12px;
    color: #A09B96; overflow: hidden; text-overflow: ellipsis;
  }
  .example-cmd strong { color: #D97757; }
  .example-model {
    font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 11px;
    color: #6BBF6B; overflow: hidden; text-overflow: ellipsis;
  }

  /* Alias editor (Step 3) */
  .alias-editor { margin-top: 16px; }
  .alias-divider {
    text-align: center; color: #5A5550; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;
    border-top: 1px solid #3D3A38; padding-top: 12px;
  }
  .alias-search {
    width: 100%; padding: 7px 10px; background: #1E1C1B;
    border: 1px solid #3D3A38; border-radius: 6px; color: #E8E0D8;
    font-size: 12px; font-family: 'SF Mono', Menlo, Monaco, monospace;
    outline: none; margin-bottom: 8px; transition: border-color 0.15s;
  }
  .alias-search:focus { border-color: #D97757; }
  .alias-search::placeholder { color: #5A5550; }
  .alias-group { margin-bottom: 2px; }
  .alias-group summary {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    cursor: pointer; font-size: 12px; font-weight: 500; color: #A09B96;
    border-radius: 4px; transition: color 0.15s; list-style: none;
  }
  .alias-group summary::-webkit-details-marker { display: none; }  .alias-group summary::before {
    content: '\\25B6'; font-size: 8px; color: #5A5550; transition: transform 0.15s;
  }
  .alias-group[open] summary::before { transform: rotate(90deg); }
  .alias-group summary:hover { color: #D97757; }
  .alias-group summary .alias-count { color: #5A5550; font-weight: 400; }
  .alias-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px 3px 22px; font-size: 12px;
  }
  .alias-name {
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    color: #E8E0D8; min-width: 90px; cursor: pointer;
  }
  .alias-arrow { color: #5A5550; font-size: 11px; }
  .alias-model {
    flex: 1; font-family: 'SF Mono', Menlo, Monaco, monospace;
    color: #7A756F; font-size: 11px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
  }
  .alias-delete {
    background: none; border: none; color: #5A5550; cursor: pointer;
    font-size: 14px; padding: 0 4px; transition: color 0.15s;
  }
  .alias-delete:hover { color: #E05252; }
  .alias-name-input, .alias-model-input {
    padding: 2px 6px; background: #1E1C1B; border: 1px solid #D97757;
    border-radius: 3px; color: #E8E0D8; font-size: 12px;
    font-family: 'SF Mono', Menlo, Monaco, monospace; outline: none;
  }
  .alias-name-input { width: 90px; }  .alias-model-input { flex: 1; }
  .alias-model-select {
    flex: 1; padding: 2px 4px; background: #1E1C1B;
    border: 1px solid #D97757; border-radius: 3px;
    color: #E8E0D8; font-size: 11px;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    outline: none; cursor: pointer; max-width: 340px;
  }
  .alias-model-select:focus { border-color: #D97757; }
  .alias-model-select option { background: #1E1C1B; color: #E8E0D8; }  .alias-model-select optgroup { color: #A09B96; font-style: normal; }
  .alias-add-btn {
    display: block; width: 100%; padding: 6px; margin-top: 8px;
    background: transparent; border: 1px dashed #3D3A38;
    border-radius: 6px; color: #7A756F; font-size: 12px;
    cursor: pointer; transition: all 0.15s;
  }
  .alias-add-btn:hover { border-color: #D97757; color: #D97757; }
  .alias-row.alias-deleted { text-decoration: line-through; opacity: 0.4; pointer-events: none; }

  /* Review (Step 4) */
  .review-section { margin-bottom: 14px; }
  .review-label { color: #A09B96; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .review-value { color: #E8E0D8; font-size: 13px; line-height: 1.5; }

  /* Footer */
  .footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 20px; border-top: 1px solid #3D3A38;
  }
  .footer-brand {
    color: #D97757; font-size: 10px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .footer-nav { display: flex; gap: 6px; }
  .nav-btn {
    padding: 6px 16px; border: 1px solid #3D3A38;
    border-radius: 6px; font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all 0.15s;
    background: transparent; color: #A09B96;
  }
  .nav-btn:hover { border-color: #D97757; color: #D97757; }  .nav-btn.primary { background: #D97757; color: #FFF; border-color: #D97757; }
  .nav-btn.primary:hover { background: #C4623F; }  .nav-btn:disabled { opacity: 0.4; cursor: default; }`;
}

module.exports = { buildWizardCSS };
