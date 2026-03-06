#!/usr/bin/env node

/**
 * Sidecar CLI Entry Point
 *
 * Spec Reference: §4 CLI Interface
 * Routes commands to appropriate handlers.
 */

// Load environment variables from .env files
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Also load API keys from ~/.config/sidecar/.env (override: false = project .env takes precedence)
const homeDir = process.env.HOME || process.env.USERPROFILE;
require('dotenv').config({ path: path.join(homeDir, '.config', 'sidecar', '.env'), override: false });

const { parseArgs, validateStartArgs, getUsage } = require('../src/cli');
const { validateTaskId, safeSessionDir } = require('../src/utils/validators');

const VERSION = require('../package.json').version;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // Non-interactive update check (skip for mcp, --version, --help)
  if (command !== 'mcp' && !args.version && !args.help) {
    const { initUpdateCheck, notifyUpdate } = require('../src/utils/updater');
    initUpdateCheck();
    process.on('exit', () => { notifyUpdate(); });
  }

  // Handle --version
  if (args.version) {
    console.log(`claude-sidecar v${VERSION}`);
    process.exit(0);
  }

  // Handle --help or no command
  if (args.help || args._.length === 0) {
    console.log(getUsage());
    process.exit(0);
  }

  try {
    switch (command) {
      case 'start':
        await handleStart(args);
        break;
      case 'list':
        await handleList(args);
        break;
      case 'resume':
        await handleResume(args);
        break;
      case 'continue':
        await handleContinue(args);
        break;
      case 'read':
        await handleRead(args);
        break;
      case 'setup':
        await handleSetup(args);
        break;
      case 'abort':
        await handleAbort(args);
        break;
      case 'mcp':
        await handleMcp();
        break;
      case 'update':
        await handleUpdate();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(getUsage());
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle 'sidecar start' command
 * Spec Reference: §4.1
 */
async function handleStart(args) {
  // Resolve model alias or use config default before validation
  const { resolveModel } = require('../src/utils/config');
  try {
    args.model = resolveModel(args.model);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Normalize agent: --agent takes precedence, otherwise use --mode
  // (Must happen before validation so --mode alias is also validated)
  args.agent = args.agent || args.mode;

  // Validate required arguments (model is now resolved)
  const validation = validateStartArgs(args);
  if (!validation.valid) {
    console.error(validation.error);
    process.exit(1);
  }

  // Lazy load to avoid circular dependencies and improve startup time
  const { startSidecar } = require('../src/index');

  const agent = args.agent;

  await startSidecar({
    taskId: args['task-id'],
    model: args.model,
    prompt: args.prompt,
    sessionId: args['session-id'],
    cwd: args.cwd,
    contextTurns: args['context-turns'],
    contextSince: args['context-since'],
    contextMaxTokens: args['context-max-tokens'],
    noUi: args['no-ui'],
    timeout: args.timeout,
    agent,
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    thinking: args.thinking,
    summaryLength: args['summary-length'],
    client: args.client,
    sessionDir: args['session-dir'],
    foldShortcut: args['fold-shortcut'],
    opencodePort: args['opencode-port'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp']
  });
}

/**
 * Handle 'sidecar list' command
 * Spec Reference: §4.2
 */
async function handleList(args) {
  const { listSidecars } = require('../src/index');

  await listSidecars({
    status: args.status,
    all: args.all,
    json: args.json,
    project: args.cwd
  });
}

/**
 * Handle 'sidecar resume' command
 * Spec Reference: §4.3
 */
async function handleResume(args) {
  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for resume');
    console.error('Usage: sidecar resume <task_id>');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  const { resumeSidecar } = require('../src/index');

  await resumeSidecar({
    taskId,
    project: args.cwd,
    headless: args['no-ui'],
    timeout: args.timeout
  });
}

/**
 * Handle 'sidecar continue' command
 * Spec Reference: §4.4
 */
async function handleContinue(args) {
  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for continue');
    console.error('Usage: sidecar continue <task_id> --prompt "..."');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  if (!args.prompt && !args.briefing) {
    console.error('Error: --prompt is required for continue');
    process.exit(1);
  }

  const { continueSidecar } = require('../src/index');

  await continueSidecar({
    taskId,
    newTaskId: args['task-id'],
    briefing: args.prompt || args.briefing,
    model: args.model,
    project: args.cwd,
    contextTurns: args['context-turns'],
    contextMaxTokens: args['context-max-tokens'],
    headless: args['no-ui'],
    timeout: args.timeout
  });
}

/**
 * Handle 'sidecar read' command
 * Spec Reference: §4.5
 */
async function handleRead(args) {
  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for read');
    console.error('Usage: sidecar read <task_id> [--summary|--conversation]');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  const { readSidecar } = require('../src/index');

  await readSidecar({
    taskId,
    summary: args.summary,
    conversation: args.conversation,
    metadata: args.metadata,
    project: args.cwd
  });
}

/**
 * Handle 'sidecar setup' command
 * Runs interactive setup wizard or adds an alias via --add-alias
 */
async function handleSetup(args) {
  const { addAlias, runInteractiveSetup, runApiKeySetup } = require('../src/sidecar/setup');

  // Standalone API key window
  if (args['api-keys']) {
    const success = await runApiKeySetup();
    if (success) {
      console.log('API keys configured successfully.');
    } else {
      console.log('API key setup was not completed.');
      process.exit(1);
    }
    return;
  }

  if (args['add-alias']) {
    const spec = args['add-alias'];
    const eqIndex = spec.indexOf('=');
    if (eqIndex === -1) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    const name = spec.slice(0, eqIndex);
    const model = spec.slice(eqIndex + 1);
    if (!name || !model) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    addAlias(name, model);
    console.log(`Alias '${name}' added: ${model}`);
    return;
  }

  await runInteractiveSetup();
}

/**
 * Handle 'sidecar abort' command
 * Marks a running session as aborted
 */
async function handleAbort(args) {
  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for abort');
    console.error('Usage: sidecar abort <task_id>');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  const project = args.cwd || process.cwd();
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.error(`Session ${taskId} not found`);
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.status = 'aborted';
  meta.abortedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  console.log(`Session ${taskId} marked as aborted.`);
}

/**
 * Handle 'sidecar update' command
 * Updates claude-sidecar to the latest version
 */
async function handleUpdate() {
  const { performUpdate, getUpdateInfo, initUpdateCheck } = require('../src/utils/updater');
  initUpdateCheck();
  const info = getUpdateInfo();
  if (info) {
    console.log(`Updating claude-sidecar ${info.current} → ${info.latest}...`);
  } else {
    console.log('Updating claude-sidecar to latest...');
  }
  const result = await performUpdate();
  if (result.success) {
    console.log(`Updated successfully! Run 'sidecar --version' to verify.`);
  } else {
    console.error(`Update failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle 'sidecar mcp' command
 * Starts the MCP server on stdio transport
 */
async function handleMcp() {
  const { startMcpServer } = require('../src/mcp-server');
  await startMcpServer();
}

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
