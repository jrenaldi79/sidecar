/**
 * Auto-Skills Configuration Module
 *
 * Manages the autoSkills namespace in ~/.config/sidecar/config.json.
 * Provides enable/disable controls and status reporting for auto-skills.
 */

const { loadConfig, saveConfig } = require('./config');

/** Valid auto-skill names (keys in autoSkills config) */
const VALID_SKILL_NAMES = ['review', 'unblock', 'security', 'bmadMethodCheck'];

/** Display labels for CLI output */
const SKILL_LABELS = {
  review: 'auto-review',
  unblock: 'auto-unblock',
  security: 'auto-security',
  bmadMethodCheck: 'auto-bmad-method-check',
};

/**
 * Get the autoSkills section from config, with defaults applied.
 * @param {object|null} [config] - Config object (loaded if not provided)
 * @returns {object} autoSkills config with defaults
 */
function getAutoSkillsConfig(config) {
  const cfg = config || loadConfig() || {};
  const autoSkills = cfg.autoSkills || {};
  return {
    enabled: autoSkills.enabled !== false,
    review: { enabled: (autoSkills.review || {}).enabled !== false },
    unblock: { enabled: (autoSkills.unblock || {}).enabled !== false },
    security: { enabled: (autoSkills.security || {}).enabled !== false },
    bmadMethodCheck: { enabled: (autoSkills.bmadMethodCheck || {}).enabled !== false },
  };
}

/**
 * Check if a specific auto-skill is enabled (master + per-skill).
 * @param {string} skillName - One of VALID_SKILL_NAMES
 * @param {object|null} [config] - Config object (loaded if not provided)
 * @returns {boolean}
 */
function isSkillEnabled(skillName, config) {
  const as = getAutoSkillsConfig(config);
  if (!as.enabled) { return false; }
  const skill = as[skillName];
  return skill ? skill.enabled !== false : false;
}

/**
 * Check if activity monitoring is enabled.
 * @param {object|null} [config] - Config object (loaded if not provided)
 * @returns {boolean}
 */
function isMonitoringEnabled(config) {
  const cfg = config || loadConfig() || {};
  const monitoring = cfg.monitoring || {};
  return monitoring.enabled !== false;
}

/**
 * Enable or disable auto-skills and save to config.
 * @param {boolean} enabled - Whether to enable or disable
 * @param {string[]} [skillNames] - Specific skills, or empty for master switch
 * @returns {boolean} true if config was saved successfully
 */
function setAutoSkillsEnabled(enabled, skillNames) {
  const config = loadConfig() || {};
  if (!config.autoSkills) { config.autoSkills = {}; }

  if (!skillNames || skillNames.length === 0) {
    config.autoSkills.enabled = enabled;
  } else {
    for (const name of skillNames) {
      if (!VALID_SKILL_NAMES.includes(name)) {
        const { logger } = require('./logger');
        logger.warn(`Ignoring invalid skill name: ${name}`);
        continue;
      }
      if (!config.autoSkills[name]) { config.autoSkills[name] = {}; }
      config.autoSkills[name].enabled = enabled;
    }
  }

  try {
    saveConfig(config);
    return true;
  } catch (err) {
    const { logger } = require('./logger');
    logger.error(`Could not save config: ${err.message}`);
    return false;
  }
}

/**
 * Get formatted status of all auto-skills for CLI display.
 * @returns {string} Multi-line status string
 */
function getAutoSkillsStatus() {
  const as = getAutoSkillsConfig();
  const lines = [];
  const masterLabel = as.enabled ? 'enabled' : 'disabled';
  lines.push(`Auto-skills: ${masterLabel}`);
  lines.push('');

  for (const name of VALID_SKILL_NAMES) {
    const label = SKILL_LABELS[name];
    const skillEnabled = as[name].enabled;
    const effective = as.enabled && skillEnabled;
    let status = effective ? 'enabled' : 'disabled';
    if (as.enabled && !skillEnabled) { status = 'disabled (per-skill)'; }
    if (!as.enabled && skillEnabled) { status = 'disabled (master off)'; }
    lines.push(`  ${label}: ${status}`);
  }

  return lines.join('\n');
}

/**
 * Validate skill names from CLI input, mapping display names to config keys.
 * @param {string[]} names - Skill names from CLI (e.g., 'review', 'auto-review')
 * @returns {{ valid: string[], invalid: string[] }}
 */
function resolveSkillNames(names) {
  // Build case-insensitive lookup from display labels to config keys
  const reverseLabels = {};
  for (const [key, label] of Object.entries(SKILL_LABELS)) {
    reverseLabels[label] = key;
    reverseLabels[label.replace('auto-', '')] = key;
  }
  // Also accept 'bmad' shorthand
  reverseLabels['bmad'] = 'bmadMethodCheck';

  // Build case-insensitive lookup for VALID_SKILL_NAMES (handles camelCase input)
  const validLower = VALID_SKILL_NAMES.map((n) => n.toLowerCase());

  const valid = [];
  const invalid = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const validIdx = validLower.indexOf(lower);
    if (validIdx !== -1) {
      valid.push(VALID_SKILL_NAMES[validIdx]);
    } else if (reverseLabels[lower]) {
      valid.push(reverseLabels[lower]);
    } else {
      invalid.push(name);
    }
  }

  return { valid, invalid };
}

module.exports = {
  VALID_SKILL_NAMES,
  SKILL_LABELS,
  getAutoSkillsConfig,
  isSkillEnabled,
  isMonitoringEnabled,
  setAutoSkillsEnabled,
  getAutoSkillsStatus,
  resolveSkillNames,
};
