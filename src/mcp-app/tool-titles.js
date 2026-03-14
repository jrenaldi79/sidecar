/**
 * Tool title/subtitle extraction for collapsed tool display.
 * @module tool-titles
 */

/** Extract tool-specific title and subtitle for collapsed display. */
function getToolTitleInfo(toolId, input) {
  if (!input || typeof input !== 'object') {
    return { title: toolId || 'tool', subtitle: null };
  }

  if (toolId === 'edit') {
    const filePath = input.file_path || input.filePath || '';
    const fileName = filePath.split('/').pop() || 'file';
    return { title: `Edit ${fileName}`, subtitle: filePath };
  }

  if (toolId === 'read') {
    const filePath = input.file_path || input.filePath || '';
    return { title: 'Read', subtitle: filePath || 'file' };
  }

  if (toolId === 'write') {
    const filePath = input.file_path || input.filePath || '';
    const fileName = filePath.split('/').pop() || 'file';
    return { title: `Write ${fileName}`, subtitle: filePath };
  }

  if (toolId === 'bash') {
    const cmd = input.command || '';
    const desc = input.description || '';
    const title = desc || (cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd) || 'Bash';
    return { title, subtitle: desc ? cmd : null };
  }

  if (toolId === 'glob' || toolId === 'grep') {
    const pattern = input.pattern || '';
    const truncated = pattern.length > 40 ? pattern.slice(0, 40) + '...' : pattern;
    return { title: toolId, subtitle: truncated };
  }

  if (toolId === 'list' || toolId === 'ls') {
    return { title: 'List', subtitle: input.path || '.' };
  }

  if (toolId === 'question' || toolId === 'askuserquestion') {
    const q = input.question || 'Question';
    const truncated = q.length > 50 ? q.slice(0, 50) + '...' : q;
    return { title: truncated, subtitle: null };
  }

  if (toolId === 'webfetch') {
    return { title: 'WebFetch', subtitle: input.url || '' };
  }

  if (toolId === 'task') {
    const desc = input.description || '';
    const truncDesc = desc.length > 50 ? desc.slice(0, 50) + '...' : desc;
    return { title: 'Task', subtitle: truncDesc || input.id || '' };
  }

  if (toolId === 'skill') {
    const skillName = input.skill || input.name || '';
    return { title: 'Skill', subtitle: skillName };
  }

  if (toolId === 'todowrite' || toolId === 'todoread') {
    const count = Array.isArray(input.todos) ? input.todos.length : 0;
    return { title: toolId === 'todowrite' ? 'TodoWrite' : 'TodoRead', subtitle: count ? `${count} items` : null };
  }

  return { title: input.description || toolId || 'tool', subtitle: null };
}

module.exports = { getToolTitleInfo };
