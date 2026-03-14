#!/usr/bin/env node

/**
 * Sidecar CLI Entry Point
 *
 * Spec Reference: §4 CLI Interface
 * Routes commands to appropriate handlers.
 */

// Load API keys from all sources: process.env > sidecar .env > auth.json
const { loadCredentials } = require('../src/utils/env-loader');
loadCredentials();

const { parseArgs, validateStartArgs, getUsage } = require('../src/cli');
const { validateTaskId } = require('../src/utils/validators');
const { resolveModelFromArgs, validateFallbackModel } = require('../src/utils/start-helpers');
const { handleSetup, handleAbort, handleUpdate, handleMcp } = require('../src/cli-handlers');

const VERSION = require('../package.json').version;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // Install crash handler for MCP-spawned processes (have --task-id)
  if (args['task-id'] && (command === 'start' || command === 'continue')) {
    const { installCrashHandler } = require('../src/sidecar/crash-handler');
    const project = args.cwd || process.cwd();
    const handler = installCrashHandler(args['task-id'], project);
    process.on('uncaughtException', (err) => {
      handler(err);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      handler(reason instanceof Error ? reason : new Error(String(reason)));
      process.exit(1);
    });
  }

  // Non-interactive update check (skip for mcp, --version, --help)
  if (command !== 'mcp' && !args.version && !args.help) {
    const { initUpdateCheck, getUpdateInfo, notifyUpdate } = require('../src/utils/updater');
    initUpdateCheck();
    // Pass update info to Electron child process via env var,
    // because update-notifier deletes the cache entry after reading it.
    const cliUpdateInfo = getUpdateInfo();
    if (cliUpdateInfo) {
      process.env.SIDECAR_UPDATE_INFO = JSON.stringify(cliUpdateInfo);
      process.on('exit', () => {
        process.stderr.write(
          `\n  Update available: v${cliUpdateInfo.current} → v${cliUpdateInfo.latest}\n` +
          '  Run `npm install -g claude-sidecar` to upgrade.\n\n'
        );
      });
    }
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
  const { model, alias } = resolveModelFromArgs(args);
  args.model = model;
  args.model = await validateFallbackModel(args, alias);

  // Normalize agent: --agent takes precedence, otherwise use --mode
  args.agent = args.agent || args.mode;

  const validation = validateStartArgs(args);
  if (!validation.valid) {
    console.error(validation.error);
    process.exit(1);
  }

  const { startSidecar } = require('../src/index');

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
    agent: args.agent,
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    thinking: args.thinking,
    summaryLength: args['summary-length'],
    client: args.client,
    sessionDir: args['session-dir'],
    foldShortcut: args['fold-shortcut'],
    opencodePort: args['opencode-port'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp'],
    coworkProcess: args['cowork-process'],
    position: args.position
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

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
