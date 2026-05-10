export function createMessageController() {
  let messageTimer = null;

  function hideInlineMessage(node) {
    if (!node) return;
    node.textContent = "";
    node.classList.add("hidden");
  }

  function showInlineMessage(node, message, type = "info") {
    if (!node) return;
    if (messageTimer) window.clearTimeout(messageTimer);
    node.textContent = message;
    node.dataset.type = type;
    node.classList.remove("hidden");
    messageTimer = window.setTimeout(() => hideInlineMessage(node), 3500);
  }

  function showAuthMessage(form, message, type = "info") {
    let messageNode = form.querySelector(".form-message");
    if (!messageNode) {
      messageNode = document.createElement("p");
      messageNode.className = "form-message";
      form.insertBefore(messageNode, form.querySelector(".primary-btn"));
    }
    showInlineMessage(messageNode, message, type);
  }

  return { hideInlineMessage, showInlineMessage, showAuthMessage };
}
