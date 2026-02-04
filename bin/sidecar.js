#!/usr/bin/env node

/**
 * Sidecar CLI Entry Point
 *
 * Spec Reference: §4 CLI Interface
 * Routes commands to appropriate handlers.
 */

// Load environment variables from .env file
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { parseArgs, validateStartArgs, getUsage } = require('../src/cli');

const VERSION = '0.1.0';

async function main() {
  const args = parseArgs(process.argv.slice(2));

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

  const command = args._[0];

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
  // Validate required arguments
  const validation = validateStartArgs(args);
  if (!validation.valid) {
    console.error(validation.error);
    process.exit(1);
  }

  // Lazy load to avoid circular dependencies and improve startup time
  const { startSidecar } = require('../src/index');

  // Determine agent: --agent takes precedence, otherwise use --mode
  const agent = args.agent || args.mode;

  await startSidecar({
    model: args.model,
    briefing: args.briefing,
    session: args.session,
    project: args.project,
    contextTurns: args['context-turns'],
    contextSince: args['context-since'],
    contextMaxTokens: args['context-max-tokens'],
    headless: args.headless,
    timeout: args.timeout,
    agent,
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    thinking: args.thinking,
    summaryLength: args['summary-length']
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
    project: args.project
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

  const { resumeSidecar } = require('../src/index');

  await resumeSidecar({
    taskId,
    project: args.project,
    headless: args.headless,
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
    console.error('Usage: sidecar continue <task_id> --briefing "..."');
    process.exit(1);
  }

  if (!args.briefing) {
    console.error('Error: --briefing is required for continue');
    process.exit(1);
  }

  const { continueSidecar } = require('../src/index');

  await continueSidecar({
    taskId,
    briefing: args.briefing,
    model: args.model,
    project: args.project,
    contextTurns: args['context-turns'],
    contextMaxTokens: args['context-max-tokens'],
    headless: args.headless,
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

  const { readSidecar } = require('../src/index');

  await readSidecar({
    taskId,
    summary: args.summary,
    conversation: args.conversation,
    metadata: args.metadata,
    project: args.project
  });
}

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
