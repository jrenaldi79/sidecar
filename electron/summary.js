/**
 * Summary Generation via OpenCode API
 *
 * Makes HTTP requests to the OpenCode server to request and poll
 * for model-generated fold summaries.
 */

const http = require('http');
const { logger } = require('../src/utils/logger');

/**
 * Make an HTTP request to the OpenCode server.
 * @param {string} method - HTTP method
 * @param {string} urlPath - URL path (e.g., '/session/abc/prompt_async')
 * @param {number} port - OpenCode server port
 * @param {object} [body] - JSON body to send
 * @returns {Promise<object>} Parsed JSON response
 */
function apiRequest(method, urlPath, port, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) { req.write(JSON.stringify(body)); }
    req.end();
  });
}

/**
 * Request the model to generate a handoff summary via the OpenCode API.
 * Sends the SUMMARY_TEMPLATE as a new message, polls for the response.
 * @param {string} sessionId - OpenCode session ID
 * @param {number} port - OpenCode server port
 * @param {Function} getSummaryTemplate - Function returning the summary prompt
 * @returns {Promise<string>} Generated summary text
 */
async function requestSummaryFromModel(sessionId, port, getSummaryTemplate) {
  if (!sessionId) { return ''; }

  const summaryPrompt = getSummaryTemplate();
  logger.info('Requesting fold summary from model', { sessionId });

  // Send summary prompt asynchronously
  await apiRequest('POST', `/session/${sessionId}/prompt_async`, port, {
    parts: [{ type: 'text', text: summaryPrompt }]
  });

  // Poll for the model's response (up to 60 seconds)
  const startTime = Date.now();
  const timeoutMs = 60000;
  let lastMessageCount = 0;
  let stablePolls = 0;
  let summaryText = '';

  while ((Date.now() - startTime) < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const messages = await apiRequest('GET', `/session/${sessionId}/message`, port);
      const msgArray = Array.isArray(messages) ? messages : [];

      // Look for the latest assistant text content
      let latestAssistantText = '';
      let assistantFinished = false;

      for (const msg of msgArray) {
        if (msg.info?.role === 'assistant') {
          if (msg.info.time?.completed) { assistantFinished = true; }
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === 'text' && part.text) {
                latestAssistantText = part.text;
              }
            }
          }
        }
      }

      // Check if stable (same message count for 2 polls and assistant finished)
      if (assistantFinished && msgArray.length === lastMessageCount) {
        stablePolls++;
        if (stablePolls >= 2) {
          summaryText = latestAssistantText;
          break;
        }
      } else {
        stablePolls = 0;
      }
      lastMessageCount = msgArray.length;

    } catch (err) {
      logger.debug('Summary poll error', { error: err.message });
    }
  }

  logger.info('Summary captured', { length: summaryText.length });
  return summaryText;
}

module.exports = { apiRequest, requestSummaryFromModel };
