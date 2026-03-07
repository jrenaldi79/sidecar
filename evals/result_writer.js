const fs = require('fs');
const path = require('path');

/**
 * Format token count as human-readable string (e.g., "15.7k tok").
 * @param {number} tokens
 * @returns {string}
 */
function formatTokens(tokens) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k tok`;
  }
  return `${tokens} tok`;
}

/**
 * Format a single eval result as a summary line.
 * @param {object} result
 * @returns {string}
 */
function formatSummaryLine(result) {
  const totalTokens = (result.token_usage?.claude?.input_tokens || 0)
    + (result.token_usage?.claude?.output_tokens || 0);
  const tokStr = formatTokens(totalTokens);
  const durStr = `${result.duration_seconds}s`;
  const scoreStr = result.score.toFixed(2);

  let sidecarInfo = '';
  const startCall = result.sidecar_calls?.find(c => c.tool === 'sidecar_start');
  if (startCall) {
    const model = startCall.params?.model || 'unknown';
    const agent = startCall.params?.agent || 'Chat';
    sidecarInfo = `\n  Sidecar: ${model}, agent=${agent}`;
    if (result.token_usage?.sidecar) {
      const sTok = (result.token_usage.sidecar.input_tokens || 0)
        + (result.token_usage.sidecar.output_tokens || 0);
      sidecarInfo += `, ${formatTokens(sTok)}`;
    }
  }

  const name = result.eval_name.padEnd(30);
  return `Eval ${result.eval_id}: ${name} ${result.status}  ${scoreStr}  (${durStr}, ${tokStr})${sidecarInfo}`;
}

/**
 * Write eval results to workspace directory.
 * @param {string} workDir - Workspace directory path
 * @param {object} result - Eval result object
 * @param {string[]} rawLines - Raw stream-json lines
 */
function writeResults(workDir, result, rawLines) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'result.json'),
    JSON.stringify(result, null, 2)
  );
  fs.writeFileSync(
    path.join(workDir, 'transcript.jsonl'),
    rawLines.join('\n') + '\n'
  );
}

/**
 * Print summary table for multiple eval results.
 * @param {object[]} results
 */
function printSummary(results) {
  console.log('\nSidecar Eval Results');
  console.log('====================');
  for (const r of results) {
    console.log(formatSummaryLine(r));
  }
  const passed = results.filter(r => r.status === 'PASS').length;
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  const totalTokens = results.reduce((s, r) => {
    return s + (r.token_usage?.claude?.input_tokens || 0)
      + (r.token_usage?.claude?.output_tokens || 0);
  }, 0);
  console.log(`\nOverall: ${passed}/${results.length} passed, avg score: ${avgScore.toFixed(2)}, total: ${formatTokens(totalTokens)}`);
}

module.exports = { writeResults, formatSummaryLine, formatTokens, printSummary };
