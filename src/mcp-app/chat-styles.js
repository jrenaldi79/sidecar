/** @module mcp-app/chat-styles — CSS for the MCP App chat resource */

const CHAT_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #2D2B2A; color: #ccc; height: 100vh; overflow: hidden;
  }
  #sidecar-app {
    display: flex; flex-direction: column; height: 100vh;
    border-top: 2px solid rgba(196, 149, 107, 0.35);
    background: rgba(196, 149, 107, 0.04);
  }
  #opencode-frame { flex: 1; border: none; width: 100%; }
  #sidecar-toolbar {
    height: 40px; background: #2D2B2A;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex; align-items: center; padding: 0 10px; gap: 8px; flex-shrink: 0;
  }
  .toolbar-info {
    display: flex; align-items: center; gap: 8px; font-size: 11px; flex-shrink: 0;
  }
  .toolbar-brand { color: #999; font-weight: 500; }
  .toolbar-sep { color: #555; }
  #model-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px 2px 5px; border-radius: 4px; font-size: 10px;
  }
  .toolbar-task-id { color: #666; font-size: 10px; }
  #timer { color: #666; font-size: 10px; }
  .toolbar-input-area {
    flex: 1; display: flex; gap: 6px; align-items: center; margin-left: 8px;
  }
  #chat-input {
    flex: 1; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
    padding: 5px 10px; color: #ccc; font-size: 11px; outline: none;
    font-family: inherit;
  }
  #chat-input:focus { border-color: rgba(255,255,255,0.2); }
  #chat-input::placeholder { color: #666; }
  #send-btn {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #999; padding: 5px 10px; border-radius: 6px; font-size: 11px; cursor: pointer;
  }
  #send-btn:hover { background: rgba(255,255,255,0.1); }
  .toolbar-divider {
    width: 1px; height: 20px; background: rgba(255,255,255,0.08); flex-shrink: 0;
  }
  #fold-btn {
    background: linear-gradient(135deg, #D97757, #c4654a); border: none;
    color: white; padding: 5px 14px; border-radius: 6px; font-size: 11px;
    cursor: pointer; font-weight: 600; box-shadow: 0 1px 4px rgba(217,119,87,0.35);
    white-space: nowrap; flex-shrink: 0;
  }
  #fold-btn:hover { filter: brightness(1.1); }
  #fold-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  #fold-btn.folded { background: #4a7c4a; box-shadow: none; }
  #fold-overlay {
    display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 40px;
    background: rgba(0,0,0,0.7); z-index: 100;
    justify-content: center; align-items: center; flex-direction: column; gap: 12px;
  }
  #fold-overlay.visible { display: flex; }
  .fold-spinner {
    width: 24px; height: 24px;
    border: 2px solid rgba(255,255,255,0.2); border-top-color: #D97757;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fold-status { color: #ccc; font-size: 13px; }
`;

module.exports = { CHAT_STYLES };
