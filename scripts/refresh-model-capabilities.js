#!/usr/bin/env node
/**
 * Refresh Model Capabilities Cache
 *
 * Fetches the latest model information from OpenRouter API and updates
 * the local cache. Run this periodically (e.g., daily via cron) or
 * when you encounter issues with new models.
 *
 * Usage:
 *   node scripts/refresh-model-capabilities.js
 *   node scripts/refresh-model-capabilities.js --info    # Show cache info
 *   node scripts/refresh-model-capabilities.js --check   # Check specific model
 */

const {
  refreshCache,
  getCacheInfo,
  getSupportedThinkingLevels,
  supportsReasoning
} = require('../src/utils/model-capabilities');

async function main() {
  const args = process.argv.slice(2);

  // Show cache info
  if (args.includes('--info')) {
    const info = getCacheInfo();
    console.log('Model Capabilities Cache Info:');
    console.log('------------------------------');
    if (!info.exists) {
      console.log('  Status: No cache exists');
      console.log('  Run without --info to create cache');
    } else {
      console.log('  Status: Cache exists');
      console.log('  Fetched: ' + info.fetchedAt);
      console.log('  Age: ' + Math.round(info.ageMs / 1000 / 60) + ' minutes');
      console.log('  Models: ' + info.modelCount);
      console.log('  Path: ' + info.cachePath);
    }
    return;
  }

  // Check specific model
  const checkIdx = args.indexOf('--check');
  if (checkIdx !== -1 && args[checkIdx + 1]) {
    const modelId = args[checkIdx + 1];
    console.log('Checking model: ' + modelId);
    console.log('------------------------------');

    const supportedLevels = await getSupportedThinkingLevels(modelId);
    const hasReasoning = await supportsReasoning(modelId);

    console.log('  Supports reasoning: ' + (hasReasoning ? 'Yes' : 'No'));
    console.log('  Thinking levels: ' + supportedLevels.join(', '));
    return;
  }

  // Refresh cache
  console.log('Fetching model capabilities from OpenRouter API...');

  try {
    const start = Date.now();
    const cache = await refreshCache();
    const elapsed = Date.now() - start;

    console.log('');
    console.log('✓ Cache refreshed successfully');
    console.log('  Models indexed: ' + cache.modelCount);
    console.log('  Time taken: ' + elapsed + 'ms');
    console.log('');

    // Show some stats
    let reasoningCount = 0;
    let effortCount = 0;

    for (const [id, model] of Object.entries(cache.models)) {
      // Skip short-name aliases to avoid double-counting
      if (!id.includes('/')) continue;

      if (model.supportsReasoning) reasoningCount++;
      if (model.supportsReasoningEffort) effortCount++;
    }

    console.log('Model Statistics:');
    console.log('  Support reasoning: ' + reasoningCount);
    console.log('  Support reasoning_effort: ' + effortCount);
    console.log('');

    // Show some example models with reasoning support
    console.log('Sample models with reasoning support:');
    let count = 0;
    for (const [id, model] of Object.entries(cache.models)) {
      if (!id.includes('/')) continue;
      if (!model.supportsReasoning) continue;

      console.log('  - ' + id);
      count++;
      if (count >= 10) {
        console.log('  ... and more');
        break;
      }
    }

  } catch (e) {
    console.error('✗ Failed to refresh cache:', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
