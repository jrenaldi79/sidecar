'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const {
  createSubagentSession,
  updateSubagentSession,
  saveSubagentSummary,
  getSession,
  getSessionDir,
  getSubagentDir,
  appendSubagentConversation
} = require('../session-manager');
const { writeProgress } = require('../sidecar/progress');
const { buildChildProcessEnv, validateSubagentLaunchProject } = require('../utils/sidecar-boundaries');
const {
  parseCodexJsonLine,
  normalizeCodexEvent
} = require('./codex-event-normalizer');

/**
 * Map Sidecar agent types onto Codex sandbox modes.
 *
 * @param {string} agentType
 * @returns {string}
 */
function resolveSandboxMode(agentType) {
  if (agentType === 'plan' || agentType === 'explore') {
    return 'read-only';
  }
  if (agentType === 'build' || agentType === 'general') {
    return 'workspace-write';
  }
  if (agentType === 'chat') {
    throw new Error('Codex backend does not support interactive chat mode');
  }
  throw new Error(`Unsupported Codex subagent type: ${agentType}`);
}

/**
 * Add a short role preamble so Codex behaves closer to OpenCode semantics.
 *
 * @param {string} agentType
 * @param {string} briefing
 * @returns {string}
 */
function addRolePreamble(agentType, briefing) {
  const preambles = {
    plan: 'ROLE: Plan. Analyze the task, propose an approach, and do not modify files.',
    explore: 'ROLE: Explore. Inspect the codebase, summarize findings, and stay read-only.',
    build: 'ROLE: Build. Complete the task directly, make necessary changes, and report what changed.',
    general: 'ROLE: General. Execute the task with full workspace access and summarize outcomes.'
  };

  const preamble = preambles[agentType];
  if (!preamble) {
    throw new Error(`Unsupported Codex subagent type: ${agentType}`);
  }

  return `${preamble}\n\n${briefing}`;
}

/**
 * Check that the local Codex CLI is available.
 *
 * @returns {Promise<void>}
 */
function assertCodexAvailable() {
  return new Promise((resolve, reject) => {
    execFile('codex', ['exec', '--help'], { env: buildChildProcessEnv() }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Attach stream handlers and finalize a spawned Codex subagent.
 *
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.parentTaskId
 * @param {string} options.subagentId
 * @param {string} options.subagentDir
 * @param {import('child_process').ChildProcess} options.child
 * @returns {Promise<void>}
 */
function monitorCodexSubagent({
  projectDir,
  parentTaskId,
  subagentId,
  subagentDir,
  child
}) {
  const stderrPath = path.join(subagentDir, 'codex-stderr.log');

  return new Promise((resolve) => {
    let stderr = '';
    let stdoutBuffer = '';
    let finalSummary = null;

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk);

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const event = parseCodexJsonLine(line);
        if (!event) {
          continue;
        }

        const normalized = normalizeCodexEvent(event);
        if (!normalized) {
          continue;
        }

        if (normalized.kind === 'assistant_text') {
          appendSubagentConversation(projectDir, parentTaskId, subagentId, {
            role: 'assistant',
            content: normalized.content
          });
          finalSummary = normalized.content;
          writeProgress(subagentDir, 'receiving', {
            stageLabel: 'Codex is generating a response...'
          });
        }

        if (normalized.kind === 'tool_use') {
          appendSubagentConversation(projectDir, parentTaskId, subagentId, {
            role: 'assistant',
            type: 'tool_use',
            toolCall: normalized.toolCall
          });
          writeProgress(subagentDir, 'receiving', {
            latestTool: normalized.toolCall.name,
            stageLabel: `Calling tool: ${normalized.toolCall.name}`
          });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      fs.appendFileSync(stderrPath, text, { mode: 0o600 });
    });

    child.on('error', (error) => {
      updateSubagentSession(projectDir, parentTaskId, subagentId, {
        status: 'error',
        exitCode: null,
        stderrPath,
        reason: error.message,
        completedAt: new Date().toISOString(),
        pid: null
      });
      resolve();
    });

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        const event = parseCodexJsonLine(stdoutBuffer);
        const normalized = normalizeCodexEvent(event);
        if (normalized && normalized.kind === 'assistant_text') {
          appendSubagentConversation(projectDir, parentTaskId, subagentId, {
            role: 'assistant',
            content: normalized.content
          });
          finalSummary = normalized.content;
        }
      }

      if (code === 0 && finalSummary) {
        saveSubagentSummary(projectDir, parentTaskId, subagentId, finalSummary);
        updateSubagentSession(projectDir, parentTaskId, subagentId, {
          backend: 'codex',
          exitCode: 0,
          stderrPath,
          pid: null
        });
        writeProgress(subagentDir, 'complete', {
          stageLabel: 'Complete'
        });
        resolve();
        return;
      }

      updateSubagentSession(projectDir, parentTaskId, subagentId, {
        status: 'error',
        exitCode: code,
        stderrPath,
        reason: stderr.trim() || `codex exited with code ${code}`,
        completedAt: new Date().toISOString(),
        pid: null
      });
      resolve();
    });
  });
}

/** Start a Codex-backed subagent and return once the subprocess is running. */
async function startCodexSubagent({
  projectDir,
  parentTaskId,
  subagentId,
  briefing,
  agentType,
  model,
}) {
  await assertCodexAvailable();

  const validatedProjectDir = validateSubagentLaunchProject({
    projectDir,
    parentTaskId,
    getSession,
    getSessionDir
  });

  const sandboxMode = resolveSandboxMode(agentType);
  const fullBriefing = addRolePreamble(agentType, briefing);

  createSubagentSession(validatedProjectDir, parentTaskId, subagentId, {
    agentType,
    briefing,
    backend: 'codex',
    sandboxMode,
    projectDir: validatedProjectDir
  });

  const subagentDir = getSubagentDir(validatedProjectDir, parentTaskId, subagentId);
  writeProgress(subagentDir, 'prompt_sent', {
    stageLabel: 'Launching Codex subagent...'
  });

  const args = ['exec', '--json', '--sandbox', sandboxMode, '-C', validatedProjectDir, '-'];
  if (model) {
    args.splice(2, 0, '--model', model);
  }

  const child = spawn('codex', args, {
    cwd: validatedProjectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildChildProcessEnv()
  });

  updateSubagentSession(validatedProjectDir, parentTaskId, subagentId, {
    backend: 'codex',
    sandboxMode,
    pid: child.pid || null,
    status: 'running'
  });

  child.stdin.end(fullBriefing);

  return {
    subagentDir,
    pid: child.pid || null,
    completion: monitorCodexSubagent({
      projectDir: validatedProjectDir,
      parentTaskId,
      subagentId,
      subagentDir,
      child
    })
  };
}

/**
 * Run a Codex-backed subagent to completion.
 *
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.parentTaskId
 * @param {string} options.subagentId
 * @param {string} options.briefing
 * @param {string} options.agentType
 * @param {string} [options.model]
 * @returns {Promise<void>}
 */
async function runCodexSubagent(options) {
  const run = await startCodexSubagent(options);
  await run.completion;
}

module.exports = {
  runCodexSubagent,
  startCodexSubagent,
  resolveSandboxMode,
  addRolePreamble,
  assertCodexAvailable
};
