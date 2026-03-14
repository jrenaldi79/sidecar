/* eslint-env browser */
/**
 * Question interaction handler for MCP App.
 * Uses event delegation on the messages container to handle clicks
 * on question option buttons, submit, skip, and "type something else".
 * Data attributes are set by question.js formatQuestionOutput.
 *
 * @module question-handler
 */

/**
 * Set up question interaction handlers on a container element.
 * @param {HTMLElement} container - Messages container for event delegation.
 * @param {object} ctx - App context providing taskId and callServerTool.
 * @param {Function} ctx.getTaskId - Returns the current task ID.
 * @param {Function} ctx.isFolded - Returns whether the session is folded.
 * @param {Function} ctx.callServerTool - Calls an MCP server tool.
 */
export function setupQuestionHandlers(container, ctx) {
  async function answerQuestion(answer) {
    const taskId = ctx.getTaskId();
    if (!taskId || ctx.isFolded()) { return; }
    try {
      await ctx.callServerTool({
        name: 'sidecar_app_answer_question',
        arguments: { taskId, answer },
      });
    } catch {
      // Answer failed silently; next poll will show current state
    }
  }

  async function skipQuestion() {
    const taskId = ctx.getTaskId();
    if (!taskId || ctx.isFolded()) { return; }
    try {
      await ctx.callServerTool({
        name: 'sidecar_app_skip_question',
        arguments: { taskId },
      });
    } catch {
      // Skip failed silently
    }
  }

  container.addEventListener('click', (e) => {
    const target = e.target;

    // Option button click (or click on child element inside button)
    const optionBtn = target.closest('.question-option-btn:not(.question-other-btn)');
    if (optionBtn && optionBtn.dataset.answer) {
      const qc = optionBtn.closest('.question-tool-container[data-pending="true"]');
      if (qc) {
        answerQuestion(optionBtn.dataset.answer);
        return;
      }
    }

    // "Type something else..." button
    const otherBtn = target.closest('[data-action="other"]');
    if (otherBtn) {
      const qc = otherBtn.closest('.question-tool-container[data-pending="true"]');
      if (qc) {
        const optionsArea = qc.querySelector('.question-input-area');
        if (optionsArea) {
          optionsArea.textContent = '';
          const wrapper = document.createElement('div');
          wrapper.className = 'question-freeform-wrapper';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'question-freeform-input';
          inp.placeholder = 'Type your answer...';
          const btn = document.createElement('button');
          btn.className = 'question-submit-btn';
          btn.textContent = 'Submit';
          wrapper.appendChild(inp);
          wrapper.appendChild(btn);
          optionsArea.appendChild(wrapper);
          inp.focus();
        }
        return;
      }
    }

    // Submit button (free-form answer)
    const submitBtn = target.closest('.question-submit-btn');
    if (submitBtn) {
      const qc = submitBtn.closest('.question-tool-container[data-pending="true"]');
      if (qc) {
        const freeInput = qc.querySelector('.question-freeform-input');
        const answer = freeInput?.value?.trim();
        if (answer) { answerQuestion(answer); }
        return;
      }
    }

    // Skip button
    const skipBtn = target.closest('[data-action="skip"]');
    if (skipBtn) {
      const qc = skipBtn.closest('.question-tool-container[data-pending="true"]');
      if (qc) {
        skipQuestion();
      }
    }
  });

  // Handle Enter key on free-form question inputs
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) { return; }
    const freeInput = e.target.closest('.question-freeform-input');
    if (!freeInput) { return; }
    const qc = freeInput.closest('.question-tool-container[data-pending="true"]');
    if (!qc) { return; }
    e.preventDefault();
    const answer = freeInput.value?.trim();
    if (answer) { answerQuestion(answer); }
  });
}
