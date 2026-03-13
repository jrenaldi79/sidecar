/** @module mcp-app/chat-script — JS for the MCP App chat resource */

const CHAT_SCRIPT = `
(function() {
  var taskId = null;
  var sessionStatus = 'loading';
  var folded = false;
  var startTime = Date.now();

  var frame = document.getElementById('opencode-frame');
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('send-btn');
  var foldBtn = document.getElementById('fold-btn');
  var timerEl = document.getElementById('timer');
  var modelBadge = document.getElementById('model-badge');
  var taskIdDisplay = document.getElementById('task-id-display');
  var overlay = document.getElementById('fold-overlay');
  var foldStatusText = document.getElementById('fold-status-text');

  // Timer
  setInterval(function() {
    if (folded) { return; }
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);

  // Init via postMessage from host
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'sidecar-init') {
      taskId = e.data.taskId;
      startTime = e.data.startTime || Date.now();
      setupSession(e.data);
    }
  });

  function setupSession(data) {
    if (data.taskId) { taskIdDisplay.textContent = data.taskId; }
    if (data.model) {
      modelBadge.textContent = data.model;
      modelBadge.style.background = 'rgba(142,117,178,0.12)';
      modelBadge.style.color = '#b8a0d2';
    }
    if (data.opencodeUrl) {
      frame.src = data.opencodeUrl;
      frame.addEventListener('load', function() {
        try {
          var doc = frame.contentDocument;
          if (doc) {
            var style = doc.createElement('style');
            style.textContent = '#root > div > header { display: none !important; }';
            doc.head.appendChild(style);
          }
        } catch (e) {
          // Cross-origin: CSS injection not possible
        }
      });
    }
    startPolling();
  }

  // Poll for status
  var pollCursor = null;
  function startPolling() {
    setInterval(function() {
      if (!taskId || folded) { return; }
      try {
        App.callTool('sidecar_app_messages', { taskId: taskId, cursor: pollCursor })
          .then(function(result) {
            var data = JSON.parse(result.content[0].text);
            if (data.cursor) { pollCursor = data.cursor; }
            sessionStatus = data.status || 'running';
          })
          .catch(function() { /* poll error, will retry */ });
      } catch (e) { /* App.callTool not available */ }
    }, 750);
  }

  // Send message
  function sendMessage() {
    var text = input.value.trim();
    if (!text || !taskId || folded) { return; }
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    App.callTool('sidecar_app_send', { taskId: taskId, message: text })
      .then(function() {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      })
      .catch(function() {
        input.value = text;
        input.disabled = false;
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Fold
  function triggerFold() {
    if (!taskId || folded) { return; }
    folded = true;
    foldBtn.disabled = true;
    foldBtn.textContent = 'Folding...';
    overlay.classList.add('visible');

    App.callTool('sidecar_app_fold', { taskId: taskId })
      .then(function(result) {
        var data = JSON.parse(result.content[0].text);
        if (data.summary) {
          App.updateContext(data.summary);
          foldStatusText.textContent = 'Summary sent to Claude';
          foldBtn.textContent = 'Folded \\u2713';
          foldBtn.classList.add('folded');
        } else {
          foldStatusText.textContent = 'Summary generation failed';
          foldBtn.textContent = 'Fold \\u23CE';
          foldBtn.disabled = false;
          folded = false;
        }
      })
      .catch(function(e) {
        foldStatusText.textContent = 'Fold error: ' + e.message;
        foldBtn.textContent = 'Fold \\u23CE';
        foldBtn.disabled = false;
        folded = false;
      });

    setTimeout(function() { overlay.classList.remove('visible'); }, 2000);
  }

  foldBtn.addEventListener('click', triggerFold);
})();
`;

module.exports = { CHAT_SCRIPT };
