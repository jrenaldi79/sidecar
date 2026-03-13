/* eslint-env browser */
/**
 * Auto-scroll controller for MCP App messages container.
 * Scrolls to bottom on new content, disables when user scrolls up.
 */

const THRESHOLD = 50; // px from bottom to consider "at bottom"

/**
 * Set up auto-scroll on a container element.
 * @param {HTMLElement} container - The scrollable messages container
 * @returns {{ scrollToBottom: Function, destroy: Function }} Cleanup handle
 */
function setupAutoScroll(container) {
  let enabled = true;

  function isNearBottom() {
    return container.scrollHeight - container.scrollTop - container.clientHeight < THRESHOLD;
  }

  function scrollToBottom() {
    if (enabled) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // Watch for new content
  const observer = new MutationObserver(() => {
    scrollToBottom();
  });

  observer.observe(container, { childList: true, subtree: true });

  // Track user scroll — re-enable when near bottom, disable when scrolled up
  container.addEventListener('scroll', () => {
    if (isNearBottom()) {
      enabled = true;
    } else {
      enabled = false;
    }
  });

  return {
    scrollToBottom() { container.scrollTop = container.scrollHeight; },
    destroy() { observer.disconnect(); },
  };
}

module.exports = { setupAutoScroll };
