export interface ChatUserMessageHandlers {
  sendPendingMessage(content: string): void;
  /**
   * `title` is an optional friendly name the dispatching app supplies for the
   * conversation it just started (e.g. "Marcie · CRM"). Without it the
   * conversation falls back to a title derived from `content`, which for an
   * app-dispatched prompt is the bracketed context envelope — unreadable, and
   * identical across every consultation the app starts.
   */
  updateThreadMetadata(threadId: string, content: string, title?: string): void;
}

const HIDDEN_CHAT_INSTRUCTION_PREFIX = '[SYSTEM:';

/**
 * Auto-greetings are sent through chat as hidden user-shaped envelopes. They
 * must never be treated as visitor-authored text or shown as conversation
 * names, even if leading whitespace or casing changes upstream.
 */
export function isHiddenChatInstruction(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trimStart().toUpperCase().startsWith(HIDDEN_CHAT_INSTRUCTION_PREFIX)
  );
}

/** Keep an internal instruction out of any shell surface that renders a name. */
export function getSafeChatThreadTitle(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== 'string') return fallback;
  const title = value.trim();
  return title && !isHiddenChatInstruction(title) ? title : fallback;
}

export function listenForChatUserMessages(
  target: EventTarget,
  handlers: ChatUserMessageHandlers,
): () => void {
  const onUserMessage = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
      return;
    }

    try {
      const contentValue = (detail as Record<string, unknown>).content;
      const content =
        typeof contentValue === 'string' ? contentValue.trim() : '';
      if (!content) return;

      if (!('threadId' in detail)) {
        handlers.sendPendingMessage(content);
        return;
      }

      const threadIdValue = (detail as Record<string, unknown>).threadId;
      if (typeof threadIdValue !== 'string' || !threadIdValue.trim()) return;
      if (isHiddenChatInstruction(content)) return;

      const titleValue = (detail as Record<string, unknown>).title;
      const title =
        typeof titleValue === 'string' && titleValue.trim()
          ? titleValue.trim().slice(0, 80)
          : undefined;

      handlers.updateThreadMetadata(threadIdValue, content, title);
    } catch {
      // Ignore malformed event detail objects, including throwing accessors.
    }
  };

  target.addEventListener('audos:chat-user-message', onUserMessage);
  return () =>
    target.removeEventListener('audos:chat-user-message', onUserMessage);
}
