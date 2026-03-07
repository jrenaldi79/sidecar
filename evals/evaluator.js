const fs = require('fs');
const path = require('path');

/**
 * Run programmatic checks against transcript and sandbox filesystem.
 * @param {Array} criteria - Programmatic criteria from eval task
 * @param {object} transcript - Parsed transcript
 * @param {string} sandboxDir - Path to sandbox directory
 * @returns {Array<{type: string, passed: boolean, detail: string}>}
 */
function runProgrammaticChecks(criteria, transcript, sandboxDir) {
  return criteria.map(c => {
    switch (c.type) {
      case 'tool_called': {
        const found = transcript.toolCalls.find(tc => tc.tool === c.tool);
        return { type: c.type, tool: c.tool, passed: !!found, detail: found ? 'Called' : 'Not called' };
      }
      case 'tool_param': {
        const call = transcript.toolCalls.find(tc => tc.tool === c.tool);
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = call.params[c.param];
        const passed = actual === c.expected;
        return { type: c.type, passed, detail: `${c.param}=${actual} (expected ${c.expected})` };
      }
      case 'tool_param_matches': {
        const call = transcript.toolCalls.find(tc => tc.tool === c.tool);
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = String(call.params[c.param] || '');
        const passed = new RegExp(c.pattern).test(actual);
        return { type: c.type, passed, detail: `${c.param}="${actual}" vs /${c.pattern}/` };
      }
      case 'file_changed': {
        const filePath = path.join(sandboxDir, c.path);
        const exists = fs.existsSync(filePath);
        return { type: c.type, path: c.path, passed: exists, detail: exists ? 'File exists' : 'File not found' };
      }
      case 'file_created': {
        const regex = new RegExp(c.pattern);
        const found = findFilesRecursive(sandboxDir).some(f => regex.test(f));
        return { type: c.type, pattern: c.pattern, passed: found, detail: found ? 'Matching file found' : 'No match' };
      }
      case 'file_contains': {
        const filePath = path.join(sandboxDir, c.path);
        if (!fs.existsSync(filePath)) {
          return { type: c.type, passed: false, detail: `File ${c.path} not found` };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const passed = new RegExp(c.pattern).test(content);
        return { type: c.type, path: c.path, passed, detail: passed ? 'Pattern matched' : 'Pattern not found' };
      }
      case 'no_errors': {
        const passed = transcript.errors.length === 0;
        return { type: c.type, passed, detail: passed ? 'No errors' : `${transcript.errors.length} errors` };
      }
      default:
        return { type: c.type, passed: false, detail: `Unknown criterion type: ${c.type}` };
    }
  });
}

/** Recursively find all files relative to baseDir */
function findFilesRecursive(baseDir, prefix = '') {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(path.join(baseDir, prefix), { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(baseDir, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

module.exports = { runProgrammaticChecks, findFilesRecursive };
