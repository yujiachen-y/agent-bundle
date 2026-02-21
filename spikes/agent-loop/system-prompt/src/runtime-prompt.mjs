const SESSION_CONTEXT_PATTERN = /{{session_context}}/g;

/**
 * Replace runtime placeholders in a pre-generated system prompt template.
 * @param {string} template
 * @param {string | undefined} sessionContext
 * @returns {string}
 */
export function applySessionContext(template, sessionContext) {
  const context = typeof sessionContext === "string" ? sessionContext.trim() : "";
  return template.replace(SESSION_CONTEXT_PATTERN, context).trimEnd();
}
