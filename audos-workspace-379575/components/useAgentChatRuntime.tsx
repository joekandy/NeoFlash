/**
 * AgentChat runtime hook (PLATFORM-MANAGED).
 *
 * This file is force-copied from genesis-space into every workspace on every
 * recompile. DO NOT edit it per-space — your changes will be overwritten. To
 * restyle the agent element, edit `components/AgentChatView.tsx` instead.
 *
 * Owns: history loading, SSE streaming, WebSocket subscription, tool-use
 * parsing, booster-message filtering, attachment upload, beacon intake,
 * greeting/welcome injection, send/draft state.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import { isTenantChatSuppressed } from '../lib/tenant-delegation-scope';

// Module-level guards prevent duplicate sends for the same visitor/thread
// across keyed v4 remounts. The key is deliberately conversation-scoped:
// different threads may stream concurrently, while switching away and back
// to a thread cannot start a second turn against its resume target.
interface SendingGuard {
  active: boolean;
  lastSentAt: number;
  owner?: object;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const SEND_COOLDOWN_MS = 1_000;
const sendingGuards = new Map<string, SendingGuard>();

function scheduleSendingGuardCleanup(key: string, guard: SendingGuard): void {
  if (typeof window === 'undefined') return;
  if (guard.cleanupTimer) clearTimeout(guard.cleanupTimer);
  const elapsed = Date.now() - guard.lastSentAt;
  const delay = Math.max(0, SEND_COOLDOWN_MS - elapsed) + 1;
  guard.cleanupTimer = setTimeout(() => {
    guard.cleanupTimer = undefined;
    if (
      sendingGuards.get(key) !== guard ||
      guard.active ||
      guard.owner
    ) {
      return;
    }
    const remaining = SEND_COOLDOWN_MS - (Date.now() - guard.lastSentAt);
    if (remaining > 0) {
      scheduleSendingGuardCleanup(key, guard);
      return;
    }
    sendingGuards.delete(key);
  }, delay);
}

function getSendingGuard(key: string): SendingGuard {
  const existing = sendingGuards.get(key);
  if (existing) return existing;
  const created: SendingGuard = { active: false, lastSentAt: 0 };
  sendingGuards.set(key, created);
  scheduleSendingGuardCleanup(key, created);
  return created;
}

function releaseSendingGuard(
  key: string,
  guard: SendingGuard,
  owner: object,
): void {
  if (guard.owner !== owner) return;
  guard.active = false;
  guard.owner = undefined;
  scheduleSendingGuardCleanup(key, guard);
}

// Trello 182365-QH9U8H7W: how long the thinking indicator keeps waiting for an
// assistant reply that the server delivers over the WebSocket after the SSE
// stream has already ended. Generous on purpose — this recovery path only
// exists so a lost reply can never leave the composer dead forever.
const REPLY_STALL_TIMEOUT_MS = 90_000;

function getReplyStallTimeoutMs(): number {
  if (typeof window !== 'undefined') {
    const override = (window as any).__AGENT_CHAT_REPLY_STALL_MS__;
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
      return override;
    }
  }
  return REPLY_STALL_TIMEOUT_MS;
}

export interface MessageContent {
  type: 'text' | 'tool_use';
  text?: string;
  name?: string;
  input?: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
  attachments?: AttachmentMeta[];
}

export interface AttachmentMeta {
  id: string;
  url: string;
  contentType: string;
  originalName: string;
}

export interface BeaconIntakeResult {
  headline: string;
  reflection: string;
  anchor: string;
  nextSteps: string[];
  starterPrompts: string[];
}

export interface FileAccessLog {
  timestamp: number;
  path: string;
  action: 'read' | 'write';
  tool: string;
}

export interface AgentChatRuntimeProps {
  spaceId: string;
  onFileAccess?: (log: FileAccessLog) => void;
  pendingMessage?: string | null;
  onPendingMessageConsumed?: () => void;
  /**
   * Task #2198 (v4 threads): which chat thread this runtime instance is bound
   * to. Absent / 'main' = the primary thread (all pre-thread history). The
   * shell remounts the chat (key={threadId}) when switching threads, so the
   * value is fixed for the lifetime of a mount.
   */
  threadId?: string;
  /**
   * Task #3395: the conversation's friendly name, when the shell (or the app
   * that started the conversation) has one. Sent with the first message so the
   * server stores it and the name survives a refresh — it never overwrites a
   * name the visitor typed themselves.
   */
  threadTitle?: string;
}

export const BEACON_SPACE_IDS = new Set(['workspace-193216']);
export const BEACON_STARTER_PROMPTS = [
  'I need help before a hard conversation.',
  'A conversation just went badly and I need to process it.',
  "They asked me for money and I don't know what to say.",
];

function getStoredBeaconIntake(spaceId: string): BeaconIntakeResult | null {
  try {
    const sessionKey = `space_session_${spaceId}`;
    const stored =
      localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);

    if (!stored || !stored.startsWith('{')) {
      return null;
    }

    const session = JSON.parse(stored);
    const intake = session?.intake?.result;

    if (
      intake &&
      typeof intake.headline === 'string' &&
      typeof intake.reflection === 'string' &&
      typeof intake.anchor === 'string' &&
      Array.isArray(intake.nextSteps) &&
      Array.isArray(intake.starterPrompts)
    ) {
      return intake as BeaconIntakeResult;
    }
  } catch (error) {
    console.error('[AgentChat] Failed to read Beacon intake state:', error);
  }

  return null;
}

// Generate unique instance ID for debugging
let instanceCounter = 0;

// localStorage key for tracking whether a welcome message has already been
// shown for a given (spaceId, sessionId). Welcome messages are injected
// client-side and never persisted server-side, so without this flag they
// re-inject on every mount/revisit.
function welcomeShownKey(spaceId: string, sid: string): string {
  return `agentchat_welcome_shown_${spaceId}_${sid}`;
}

function hasWelcomeBeenShown(spaceId: string, sid: string | undefined): boolean {
  if (!sid) return false;
  try {
    return localStorage.getItem(welcomeShownKey(spaceId, sid)) === 'true';
  } catch {
    return false;
  }
}

function markWelcomeShown(spaceId: string, sid: string | undefined): void {
  if (!sid) return;
  try {
    localStorage.setItem(welcomeShownKey(spaceId, sid), 'true');
  } catch {
    // localStorage unavailable (private mode, quota); fall through silently
  }
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Kept inside this force-copied runtime so existing spaces do not need a newer
// shell helper merely to compile. Every hidden-envelope check in this file
// routes through the same predicate.
function isHiddenChatInstruction(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trimStart().toUpperCase().startsWith('[SYSTEM:')
  );
}

// Parse a config value into a clean string[] of conversation-starter buttons.
// Accepts a JSON array of strings; ignores empties; caps at 6 to keep the
// empty-state tidy.
function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  return cleaned.slice(0, 6);
}

// Keep the raw names (including unknown names and an empty list) intact for
// the existing server-side normalizer. It owns trimming, deduplication, caps,
// and the narrowing-only fallback semantics.
function getToolScope(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function claudeSessionStorageKey(
  spaceId: string,
  visitorOrSessionId: string,
  threadId: string,
): string {
  const safePart = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
  return `claude_session_${safePart(spaceId)}_${safePart(visitorOrSessionId)}_${safePart(threadId)}`;
}

function readClaudeSessionId(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function writeClaudeSessionId(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session resume is an enhancement; blocked storage must not break chat.
  }
}

interface InlineAgentConfig {
  welcomeMessage: string | null;
  greetingPrompt: string | null;
  greetingAutoSend: boolean;
  agentName: string | null;
  thinkingText: string | null;
  starterPrompts: string[];
  toolScope: string[] | undefined;
  hasConversationConfig: boolean;
}

function getInlineAgentConfig(): InlineAgentConfig {
  if (typeof window === 'undefined') {
    return {
      welcomeMessage: null,
      greetingPrompt: null,
      greetingAutoSend: false,
      agentName: null,
      thinkingText: null,
      starterPrompts: [],
      toolScope: undefined,
      hasConversationConfig: false,
    };
  }

  const inlineConfig = (window as any).__SPACE_CONFIG__;
  if (!inlineConfig || typeof inlineConfig !== 'object') {
    return {
      welcomeMessage: null,
      greetingPrompt: null,
      greetingAutoSend: false,
      agentName: null,
      thinkingText: null,
      starterPrompts: [],
      toolScope: undefined,
      hasConversationConfig: false,
    };
  }

  const rootConfig = inlineConfig as Record<string, unknown>;
  const agentConfig =
    rootConfig.agent && typeof rootConfig.agent === 'object'
      ? (rootConfig.agent as Record<string, unknown>)
      : null;

  const welcomeMessage = getNonEmptyString(agentConfig?.welcomeMessage);
  const greetingPrompt = getNonEmptyString(agentConfig?.greetingPrompt);
  const greetingAutoSend = agentConfig?.greetingAutoSend === true;
  const agentName =
    getNonEmptyString(agentConfig?.name) || getNonEmptyString(rootConfig.name);
  const thinkingText = getNonEmptyString(agentConfig?.thinkingText);
  const starterPrompts = getStringArray(agentConfig?.starterPrompts);
  const toolScope = getToolScope(agentConfig?.toolScope);

  return {
    welcomeMessage,
    greetingPrompt,
    greetingAutoSend,
    agentName,
    thinkingText,
    starterPrompts,
    toolScope,
    hasConversationConfig: Boolean(welcomeMessage || greetingPrompt),
  };
}

/**
 * The compiled bundle assigns the whole space CONFIG to
 * `window.__SPACE_CONFIG__` before the app mounts. Whenever it carries an
 * `agent` block the inline config is authoritative for first paint — the chat
 * can render its greeting and composer without waiting on the network, even
 * for spaces that configure the agent without a welcome message or greeting
 * prompt.
 */
function hasAuthoritativeInlineSpaceConfig(): boolean {
  if (typeof window === 'undefined') return false;
  const inlineConfig = (window as any).__SPACE_CONFIG__;
  if (!inlineConfig || typeof inlineConfig !== 'object') return false;
  const agent = (inlineConfig as Record<string, unknown>).agent;
  return agent !== null && typeof agent === 'object';
}

function readStoredSpaceSessionField(
  spaceId: string,
  field: 'workspaceSessionId' | 'email',
): string | null {
  try {
    const stored = localStorage.getItem(`space_session_${spaceId}`);
    if (stored && stored.startsWith('{')) {
      const session = JSON.parse(stored);
      return session[field] || null;
    }
  } catch {
    // Unreadable storage — treat as "nothing to look up".
  }
  return null;
}

/**
 * Mirrors the early-return in the history effect: history is only requested
 * when there is a session id or a stored email. Seeding `isLoadingHistory`
 * from this keeps first-time visitors out of a loading state that no request
 * will ever clear.
 */
function willRequestChatHistory(spaceId: string, sessionId?: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isTenantChatSuppressed()) return false;
  } catch {
    return false;
  }
  const effectiveSessionId =
    sessionId && (sessionId.startsWith('wses_') || sessionId.startsWith('guest_'))
      ? sessionId
      : readStoredSpaceSessionField(spaceId, 'workspaceSessionId');
  if (effectiveSessionId) return true;
  if (readStoredSpaceSessionField(spaceId, 'email')) return true;
  return false;
}

export interface AgentChatRuntime {
  spaceId: string;
  /**
   * The visitor's space session id, as resolved by SpaceRuntimeContext.
   *
   * Part of the contract for the same reason as `setMessages`: per-space chat
   * views key their own persistence (saved threads, resume links, analytics)
   * on the session the chat is running under. The hook has always read this
   * off `useSpaceRuntime()` internally without re-exporting it, so a view that
   * destructured it silently read `undefined` forever.
   *
   * Undefined until the session bootstraps — views must handle that.
   */
  sessionId: string | undefined;

  // Conversation state
  messages: ChatMessage[];
  /**
   * Task #4977: the message setter is part of the contract.
   *
   * The compiler force-copies this hook into every space on every compile,
   * while deliberately preserving a space's own `AgentChatView.tsx`. A view
   * that appends to the conversation itself (a save prompt, a restored
   * history thread) destructures `setMessages` — and when it went missing
   * from the returned object the served space threw
   * `setMessages is not a function` on the visitor's screen, then "fixed" it
   * with a guard that silently dropped every conversation update instead.
   * Removing this again breaks tenant views that the platform cannot see.
   */
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  streamingContent: string;
  isStreaming: boolean;
  loading: boolean;
  lastAction: string | undefined;
  isLoadingHistory: boolean;
  hasLoadedHistory: boolean;

  // Composer state
  input: string;
  setInput: (value: string) => void;
  pendingAttachments: AttachmentMeta[];
  isUploadingAttachment: boolean;
  isDraggingOver: boolean;

  // Refs the view binds onto DOM nodes
  messagesEndRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  dropZoneRef: React.RefObject<HTMLDivElement>;

  // Actions
  abortStream: () => void;
  sendMessage: () => Promise<void>;
  sendMessageWithContent: (
    content: string,
    attachments: AttachmentMeta[],
  ) => Promise<void>;
  removeAttachment: (id: string) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handlePaste: (e: React.ClipboardEvent) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // Config-derived
  configWelcomeMessage: string | null;
  greetingPrompt: string | null;
  isConfigLoaded: boolean;
  greetingSent: boolean;
  welcomeInjectedSource: 'config' | 'session' | 'fallback' | null;

  // Space-specific
  isBeaconSpace: boolean;
  agentLabel: string;
  thinkingText: string | null;
  beaconIntake: BeaconIntakeResult | null;
  beaconStarterPrompts: string[];
  // Config-driven conversation-starter buttons for the generic empty state
  // (agent.starterPrompts in config.json). Empty array hides them.
  starterPrompts: string[];
  shortcutPrefix: string;
}

export function useAgentChatRuntime(
  props: AgentChatRuntimeProps,
): AgentChatRuntime {
  const { spaceId, onFileAccess, pendingMessage, onPendingMessageConsumed, threadId, threadTitle } = props;
  // Primary thread = absent or the canonical 'main' id. Greeting/welcome
  // logic only fires here; secondary threads always start clean.
  const isPrimaryThread = !threadId || threadId === 'main';

  const { sessionId, visitorId, trackEvent } = useSpaceRuntime();
  const inlineAgentConfig = getInlineAgentConfig();
  const inlineToolScopeKey =
    inlineAgentConfig.toolScope === undefined
      ? 'undefined'
      : JSON.stringify(inlineAgentConfig.toolScope);
  // U7 — validated tenant-task context / standing access (R42): the space's
  // own chat is fully suppressed — no history load, no greeting auto-send,
  // no WebSocket, no sends, no attachment uploads. The canonical task
  // conversation renders in the parent Product Run chrome instead.
  const chatSuppressed = isTenantChatSuppressed();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastAction, setLastAction] = useState<string | undefined>();
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // Seeded from whether the history effect below will actually issue a
  // request. A visitor with no session or email loads no history, so the chat
  // must not open in a loading state nothing will clear.
  const [isLoadingHistory, setIsLoadingHistory] = useState(() =>
    willRequestChatHistory(spaceId, sessionId),
  );
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [pendingMessageRetryNonce, setPendingMessageRetryNonce] = useState(0);
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | undefined>();
  const [configWelcomeMessage, setConfigWelcomeMessage] = useState<string | null>(
    inlineAgentConfig.welcomeMessage,
  );
  const [sessionWelcomeMessage, setSessionWelcomeMessage] = useState<string | null>(null);
  const [greetingPrompt, setGreetingPrompt] = useState<string | null>(
    inlineAgentConfig.greetingPrompt,
  );
  const [greetingAutoSend, setGreetingAutoSend] = useState<boolean>(
    inlineAgentConfig.greetingAutoSend,
  );
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [beaconIntake, setBeaconIntake] = useState<BeaconIntakeResult | null>(null);
  const [configAgentName, setConfigAgentName] = useState<string | null>(
    inlineAgentConfig.agentName,
  );
  const [configThinkingText, setConfigThinkingText] = useState<string | null>(
    inlineAgentConfig.thinkingText,
  );
  const [configStarterPrompts, setConfigStarterPrompts] = useState<string[]>(
    inlineAgentConfig.starterPrompts,
  );
  const [configToolScope, setConfigToolScope] = useState<string[] | undefined>(
    inlineAgentConfig.toolScope,
  );

  // State mirrors of internal guard refs so the view can react to them.
  const [welcomeInjectedSource, setWelcomeInjectedSource] =
    useState<'config' | 'session' | 'fallback' | null>(null);
  const [greetingSent, setGreetingSent] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const pendingMessageClaimedRef = useRef(false);
  const pendingMessageRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSendingRef = useRef(false);
  const welcomeInjectedSourceRef = useRef<'config' | 'session' | 'fallback' | null>(null);
  const greetingSentRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const sseMessageIdsRef = useRef<Set<string>>(new Set());
  const isSSEActiveRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Trello B6YlUB0F: distinguish a visitor hitting Stop from a dropped
  // fetch (proxy/browser abort). Only the Stop path stays silent.
  const userStoppedStreamRef = useRef(false);
  const partialStreamTextRef = useRef('');
  // Trello 182365-QH9U8H7W: per-turn "assistant reply committed" tracking.
  // The SSE stream can end before the assistant reply is committed to the
  // transcript (the server intentionally delivers some replies later over the
  // WebSocket `session_message` path), so `loading` must derive from whether
  // the reply actually landed — not from stream lifecycle alone.
  const awaitingAssistantReplyRef = useRef(false);
  const assistantReplyCommittedRef = useRef(false);
  const replyStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const streamGenerationRef = useRef(0);
  const activeTurnOwnerRef = useRef<object | undefined>(undefined);
  const activeSendingGuardRef = useRef<SendingGuard | undefined>(undefined);
  const activeSendingGuardKeyRef = useRef<string | undefined>(undefined);
  const instanceId = useRef(++instanceCounter);
  const isBeaconSpace = BEACON_SPACE_IDS.has(spaceId);
  const resumeIdentity = sessionId || visitorId || 'anonymous';
  const conversationThreadId = threadId && threadId.trim() ? threadId.trim() : 'main';
  const conversationKey = `${spaceId}:${resumeIdentity}:${conversationThreadId}`;
  const conversationKeyRef = useRef(conversationKey);
  const sendingGuard = getSendingGuard(conversationKey);
  const effectiveAgentName = configAgentName || inlineAgentConfig.agentName;
  const effectiveThinkingText = configThinkingText || inlineAgentConfig.thinkingText;
  const agentLabel = effectiveAgentName || (isBeaconSpace ? 'Beacon' : 'Agent');

  const markWelcomeInjected = (source: 'config' | 'session' | 'fallback') => {
    welcomeInjectedSourceRef.current = source;
    setWelcomeInjectedSource(source);
  };

  const markGreetingSent = () => {
    greetingSentRef.current = true;
    setGreetingSent(true);
  };

  const clearReplyStallTimer = () => {
    if (replyStallTimerRef.current) {
      clearTimeout(replyStallTimerRef.current);
      replyStallTimerRef.current = null;
    }
  };

  // The in-flight turn is finished (reply committed, errored, aborted, or
  // stalled out) — release the thinking indicator and the composer.
  const settleTurn = () => {
    awaitingAssistantReplyRef.current = false;
    clearReplyStallTimer();
    setLoading(false);
    setIsStreaming(false);
    setStreamingContent('');
  };

  const commitInterruptedTurn = (partialText: string, opts?: { silent?: boolean }) => {
    setMessages((prev) => {
      const next = [...prev];
      if (partialText) {
        const last = next[next.length - 1];
        const lastText =
          last && last.role === 'assistant' && typeof last.content === 'string'
            ? last.content
            : '';
        if (lastText !== partialText) {
          next.push({ role: 'assistant', content: partialText });
        }
      }
      if (!opts?.silent) {
        next.push({
          role: 'assistant',
          content: 'Sorry, the reply was interrupted. Please try again.',
        });
      }
      return next;
    });
    settleTurn();
  };

  // Bounded stall recovery: if the awaited assistant reply never arrives
  // (SSE ended and the WebSocket delivery was lost), keep any partial tokens
  // and surface a retry instead of silently clearing the bubble.
  const armReplyStallTimer = () => {
    clearReplyStallTimer();
    replyStallTimerRef.current = setTimeout(() => {
      replyStallTimerRef.current = null;
      if (awaitingAssistantReplyRef.current) {
        console.warn(
          '[AgentChat] No assistant reply arrived within the stall timeout — releasing the composer (the reply may have been lost)',
        );
        commitInterruptedTurn(partialStreamTextRef.current);
      }
    }, getReplyStallTimeoutMs());
  };

  // Never leave a stall timer running after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamGenerationRef.current += 1;
      clearReplyStallTimer();
      // Release only this mount's owner. The aborted reader may settle later;
      // its finally block must not be able to clear a newer mount's lock.
      const activeGuard = activeSendingGuardRef.current;
      const activeGuardKey = activeSendingGuardKeyRef.current;
      if (activeGuard && activeGuardKey && activeTurnOwnerRef.current) {
        releaseSendingGuard(activeGuardKey, activeGuard, activeTurnOwnerRef.current);
      }
      activeTurnOwnerRef.current = undefined;
      activeSendingGuardRef.current = undefined;
      activeSendingGuardKeyRef.current = undefined;
      // A keyed v4 thread unmount must not leave its stream competing with the
      // newly selected thread. The server may finish the request, but no late
      // browser events can update this unmounted conversation.
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debug: Log mount/unmount
  useEffect(() => {
    console.log(`[AgentChat] Instance ${instanceId.current} MOUNTED for spaceId: ${spaceId}`);
    return () => {
      console.log(`[AgentChat] Instance ${instanceId.current} UNMOUNTED`);
    };
  }, [spaceId]);

  useEffect(() => {
    const previousConversationKey = conversationKeyRef.current;
    conversationKeyRef.current = conversationKey;
    if (previousConversationKey === conversationKey) return;

    // Managed AgentChat normally remounts on a thread switch, but custom
    // views may reuse this hook instance. Invalidate the old turn before the
    // new history request can make that conversation sendable.
    streamGenerationRef.current += 1;
    abortControllerRef.current?.abort();
    isSSEActiveRef.current = false;
    sseMessageIdsRef.current.clear();
    awaitingAssistantReplyRef.current = false;
    assistantReplyCommittedRef.current = false;
    partialStreamTextRef.current = '';
    const activeGuard = activeSendingGuardRef.current;
    const activeGuardKey = activeSendingGuardKeyRef.current;
    if (activeGuard && activeGuardKey && activeTurnOwnerRef.current) {
      releaseSendingGuard(activeGuardKey, activeGuard, activeTurnOwnerRef.current);
    }
    activeTurnOwnerRef.current = undefined;
    activeSendingGuardRef.current = undefined;
    activeSendingGuardKeyRef.current = undefined;
    isSendingRef.current = false;
    clearReplyStallTimer();
    setMessages([]);
    setLoading(false);
    setIsStreaming(false);
    setStreamingContent('');
    setHasLoadedHistory(false);
    setIsLoadingHistory(willRequestChatHistory(spaceId, sessionId));
  }, [conversationKey, spaceId, sessionId]);

  useEffect(() => {
    const initialInlineAgentConfig = getInlineAgentConfig();
    setSessionWelcomeMessage(null);
    setConfigWelcomeMessage(initialInlineAgentConfig.welcomeMessage);
    setGreetingPrompt(initialInlineAgentConfig.greetingPrompt);
    setGreetingAutoSend(initialInlineAgentConfig.greetingAutoSend);
    setIsConfigLoaded(false);
    setConfigAgentName(initialInlineAgentConfig.agentName);
    setConfigThinkingText(initialInlineAgentConfig.thinkingText);
    setConfigStarterPrompts(initialInlineAgentConfig.starterPrompts);
    setConfigToolScope(initialInlineAgentConfig.toolScope);
    welcomeInjectedSourceRef.current = null;
    setWelcomeInjectedSource(null);
    greetingSentRef.current = false;
    setGreetingSent(false);

    let cancelled = false;
    const loadAgentConfig = async () => {
      let sawInlineGreeting = Boolean(initialInlineAgentConfig.greetingPrompt);
      let sawInlineWelcome = Boolean(initialInlineAgentConfig.welcomeMessage);
      try {
        if (!cancelled) {
          if (initialInlineAgentConfig.welcomeMessage) {
            console.log('[AgentChat] Loaded welcome message from inline config');
          }
          if (initialInlineAgentConfig.greetingPrompt) {
            console.log('[AgentChat] Loaded greeting prompt from inline config');
          }
        }

        if (hasAuthoritativeInlineSpaceConfig()) {
          // First paint is already correct from the baked config. Agent-driven
          // edits write config.json as a draft, so keep a freshness refresh —
          // but make it ONE public request instead of the authenticated file
          // read plus its public fallback, and only apply values that differ.
          try {
            const pubRes = await fetch(`/api/space/${spaceId}/agent-config`);
            if (cancelled || !pubRes.ok) return;
            const pubData = await pubRes.json();
            if (cancelled) return;
            const agent =
              pubData?.agent && typeof pubData.agent === 'object' ? pubData.agent : null;

            const freshWelcome = getNonEmptyString(agent?.welcomeMessage);
            if (freshWelcome && freshWelcome !== initialInlineAgentConfig.welcomeMessage) {
              setConfigWelcomeMessage(freshWelcome);
            }
            const freshGreeting = getNonEmptyString(agent?.greetingPrompt);
            if (freshGreeting && freshGreeting !== initialInlineAgentConfig.greetingPrompt) {
              setGreetingPrompt(freshGreeting);
            }
            if (
              agent?.greetingAutoSend === true &&
              !initialInlineAgentConfig.greetingAutoSend
            ) {
              setGreetingAutoSend(true);
            }
            const freshName =
              getNonEmptyString(agent?.name) || getNonEmptyString(pubData?.name);
            if (freshName && freshName !== initialInlineAgentConfig.agentName) {
              setConfigAgentName(freshName);
            }
            const freshThinking = getNonEmptyString(agent?.thinkingText);
            if (freshThinking && freshThinking !== initialInlineAgentConfig.thinkingText) {
              setConfigThinkingText(freshThinking);
            }
            const freshStarters = getStringArray(agent?.starterPrompts);
            if (
              freshStarters.length > 0 &&
              freshStarters.join('\u0000') !==
                initialInlineAgentConfig.starterPrompts.join('\u0000')
            ) {
              setConfigStarterPrompts(freshStarters);
            }
            const freshToolScope = getToolScope(agent?.toolScope);
            setConfigToolScope(freshToolScope);
          } catch {
            // Background refresh only — the inline config already painted.
          }
          return;
        }

        const res = await fetch(`/api/space/${spaceId}/file/config.json`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          const config = JSON.parse(data.content);
          if (config?.agent?.welcomeMessage) {
            setConfigWelcomeMessage(config.agent.welcomeMessage);
            if (!sawInlineWelcome) console.log('[AgentChat] Loaded welcome message from config');
          }
          if (config?.agent?.greetingPrompt) {
            setGreetingPrompt(config.agent.greetingPrompt);
            if (!sawInlineGreeting) console.log('[AgentChat] Loaded greeting prompt from config');
          }
          if (config?.agent?.greetingAutoSend === true) {
            setGreetingAutoSend(true);
          }
          if (config?.agent?.name) {
            setConfigAgentName(config.agent.name);
          } else if (config?.name) {
            setConfigAgentName(config.name);
          }
          if (config?.agent?.thinkingText) {
            setConfigThinkingText(config.agent.thinkingText);
          }
          {
            const parsed = getStringArray(config?.agent?.starterPrompts);
            if (parsed.length > 0) setConfigStarterPrompts(parsed);
          }
          const fileToolScope = getToolScope(config?.agent?.toolScope);
          setConfigToolScope(fileToolScope);
        } else {
          console.warn(
            `[AgentChat] Config fetch unavailable (${res.status}) — trying public agent-config endpoint`,
          );
          try {
            const pubRes = await fetch(`/api/space/${spaceId}/agent-config`);
            if (cancelled) return;
            if (pubRes.ok) {
              const pubData = await pubRes.json();
              if (cancelled) return;
              if (pubData?.agent?.welcomeMessage) {
                setConfigWelcomeMessage(pubData.agent.welcomeMessage);
              }
              if (pubData?.agent?.greetingPrompt) {
                setGreetingPrompt(pubData.agent.greetingPrompt);
              }
              if (pubData?.agent?.greetingAutoSend === true) {
                setGreetingAutoSend(true);
              }
              if (pubData?.agent?.name) {
                setConfigAgentName(pubData.agent.name);
              } else if (pubData?.name) {
                setConfigAgentName(pubData.name);
              }
              if (pubData?.agent?.thinkingText) {
                setConfigThinkingText(pubData.agent.thinkingText);
              }
              {
                const parsed = getStringArray(pubData?.agent?.starterPrompts);
                if (parsed.length > 0) setConfigStarterPrompts(parsed);
              }
              const publicToolScope = getToolScope(pubData?.agent?.toolScope);
              setConfigToolScope(publicToolScope);
              console.log('[AgentChat] Loaded agent config from public endpoint');
            }
          } catch {
            // Public endpoint also failed — rely on inline config
          }
        }
      } catch (e) {
        console.error('[AgentChat] Failed to load agent config:', e);
      } finally {
        if (!cancelled) setIsConfigLoaded(true);
      }
    };
    loadAgentConfig();
    return () => {
      cancelled = true;
    };
  }, [spaceId, inlineToolScopeKey]);

  useEffect(() => {
    const handleSessionReady = (event: CustomEvent) => {
      if (event.detail?.welcomeMessage) {
        console.log('[AgentChat] Received session welcome message from agentSessionReady event');
        setSessionWelcomeMessage(event.detail.welcomeMessage);
      }
    };

    window.addEventListener('agentSessionReady', handleSessionReady as EventListener);

    return () => {
      window.removeEventListener('agentSessionReady', handleSessionReady as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isBeaconSpace) {
      setBeaconIntake(null);
      return;
    }
    setBeaconIntake(getStoredBeaconIntake(spaceId));
  }, [isBeaconSpace, spaceId, sessionId]);

  // Task #4409: a stored session is usable identity when the server either
  // verified it (OTP flow) or explicitly authorized it as a legacy
  // registration session (OTP-disabled workspaces store verified:false,
  // authorized:true, identityMode:'legacy_registration'). Both flags come
  // from the server — never invented client-side — and the server re-checks
  // policy on every request.
  const isUsableStoredSession = (session: any) =>
    session?.verified === true ||
    (session?.authorized === true &&
      session?.identityMode === 'legacy_registration');

  // Task #4564: a space owns its own email gate, and a gate that changes its
  // sign-in rules typically *versions* the key it writes the session under
  // (`space_session_v105_<spaceId>`) so returning visitors re-authenticate
  // once. This hook is platform-managed and force-overwritten, so it cannot be
  // taught the space's key locally — and reading only the canonical key made
  // the whole history load silently skip ("No verified session") while the
  // shell, holding the same session in memory, still listed the conversations.
  // Every past conversation then opened blank.
  //
  // So: find the session for THIS space under any `space_session_*_<spaceId>`
  // key, newest first, canonical key winning ties. Delegation-scoped keys
  // (`space_session_<spaceId>__consumer_<id>`) belong to a different principal
  // and never match the suffix, so they are not adopted here. The usability
  // gate is unchanged — only server-set flags count, and the server re-checks
  // identity on every request.
  const readUsableStoredSession = (): any | null => {
    const canonicalKey = `space_session_${spaceId}`;
    const candidateKeys: string[] = [canonicalKey];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key === canonicalKey) continue;
        if (key.startsWith('space_session_') && key.endsWith(`_${spaceId}`)) {
          candidateKeys.push(key);
        }
      }
    } catch (e) {
      console.error('[AgentChat] Failed to scan stored space sessions:', e);
    }

    let best: any = null;
    let bestTimestamp = -1;
    for (const key of candidateKeys) {
      try {
        const stored = localStorage.getItem(key);
        if (!stored || !stored.startsWith('{')) continue;
        const session = JSON.parse(stored);
        if (!isUsableStoredSession(session)) continue;
        const timestamp =
          typeof session.timestamp === 'number' ? session.timestamp : 0;
        if (timestamp > bestTimestamp) {
          best = session;
          bestTimestamp = timestamp;
        }
      } catch (e) {
        // A single unreadable blob must not hide a good session under another key.
      }
    }
    return best;
  };

  const getSessionEmail = () => {
    try {
      const session = readUsableStoredSession();
      return session?.email || null;
    } catch (e) {
      console.error('[AgentChat] Failed to get session email:', e);
    }
    return null;
  };

  const getStoredWorkspaceSessionId = () => {
    try {
      const session = readUsableStoredSession();
      const id = session?.workspaceSessionId;
      return typeof id === 'string' && id.startsWith('wses_') ? id : null;
    } catch (e) {
      console.error('[AgentChat] Failed to get stored workspaceSessionId:', e);
    }
    return null;
  };

  // Load chat history when component mounts (if user has email session)
  useEffect(() => {
    const requestId = ++historyRequestIdRef.current;
    let cancelled = false;
    const isCurrentRequest = () =>
      !cancelled && historyRequestIdRef.current === requestId;

    if (chatSuppressed) {
      // U7: suppressed contexts never call /space/:spaceId/chat/history.
      setIsLoadingHistory(false);
      setHasLoadedHistory(true);
      return () => {
        cancelled = true;
      };
    }
    const loadHistory = async () => {
      const params = new URLSearchParams();
      params.set('contextType', 'space');
      if (threadId) {
        params.set('threadId', threadId);
      }

      const storedVerifiedSessionId = getStoredWorkspaceSessionId();
      const effectiveSessionId =
        sessionId === storedVerifiedSessionId
          ? sessionId
          : storedVerifiedSessionId;

      if (effectiveSessionId) {
        params.set('sessionId', effectiveSessionId);
        console.log('[AgentChat] Using sessionId for history lookup:', effectiveSessionId);
        setWorkspaceSessionId(effectiveSessionId);
      }

      const email = getSessionEmail();
      if (email) {
        params.set('email', email);
      }

      if (!effectiveSessionId) {
        console.log('[AgentChat] No verified session, skipping history load');
        if (isCurrentRequest()) {
          setIsLoadingHistory(false);
          setHasLoadedHistory(true);
        }
        return;
      }

      // A request IS going out now (the seed may have started false, or the
      // session arrived after mount) — reflect that in the loading state so a
      // returning visitor never sees the greeting ahead of their transcript.
      setIsLoadingHistory(true);

      try {
        console.log('[AgentChat] Loading chat history with params:', params.toString());
        const response = await fetch(
          `/api/space/${spaceId}/chat/history?${params.toString()}`,
        );

        if (response.ok) {
          const data = await response.json();
          if (!isCurrentRequest()) return;
          console.log('[AgentChat] History response:', data);

          if (data.workspaceSessionId && !effectiveSessionId) {
            console.log(
              '[AgentChat] workspace_session.id for WebSocket subscription:',
              data.workspaceSessionId,
            );
            setWorkspaceSessionId(data.workspaceSessionId);
          } else if (effectiveSessionId) {
            console.log('[AgentChat] Keeping sessionId:', effectiveSessionId);
          } else {
            console.warn('[AgentChat] No workspaceSessionId returned from history endpoint');
          }

          if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
            const transformedMessages: ChatMessage[] = [];
            for (const msg of data.messages) {
              if (!msg || typeof msg !== 'object') continue;
              const role = msg.role as 'user' | 'assistant';

              if (role === 'user') {
                transformedMessages.push({
                  role,
                  content: typeof msg.content === 'string' ? msg.content : (msg.content ?? ''),
                });
              } else {
                let content: string | MessageContent[] = msg.content ?? '';

                let events: any[] | null = null;
                if (Array.isArray(content)) {
                  events = content;
                } else if (typeof content === 'string' && content.startsWith('[')) {
                  try {
                    events = JSON.parse(content);
                  } catch (e) {
                    // Not valid JSON, keep as string
                  }
                }

                if (events && Array.isArray(events)) {
                  try {
                    let extractedText = '';

                    const textChunks = events
                      .filter((e: any) => e.type === 'text_chunk' && e.data?.text)
                      .map((e: any) => e.data.text)
                      .join('');

                    if (textChunks) {
                      extractedText = textChunks;
                    }

                    if (!extractedText) {
                      const deltaChunks = events
                        .filter(
                          (e: any) => e.type === 'content_block_delta' && e.data?.delta?.text,
                        )
                        .map((e: any) => e.data.delta.text)
                        .join('');
                      if (deltaChunks) {
                        extractedText = deltaChunks;
                      }
                    }

                    if (!extractedText) {
                      const assistantEvent = events.find(
                        (e: any) => e.type === 'assistant' && e.data?.content,
                      );
                      if (assistantEvent?.data?.content) {
                        const textParts = assistantEvent.data.content
                          .filter((c: any) => c.type === 'text')
                          .map((c: any) => c.text)
                          .join('');
                        if (textParts) {
                          extractedText = textParts;
                        }
                      }
                    }

                    if (!extractedText) {
                      const messageEvent = events.find(
                        (e: any) => e.type === 'message' && e.data?.content,
                      );
                      if (messageEvent?.data?.content) {
                        const textParts = messageEvent.data.content
                          .filter((c: any) => c.type === 'text')
                          .map((c: any) => c.text)
                          .join('');
                        if (textParts) {
                          extractedText = textParts;
                        }
                      }
                    }

                    if (!extractedText) {
                      const resultEvent = events.find(
                        (e: any) => e.type === 'result' && typeof e.data?.result === 'string',
                      );
                      if (resultEvent?.data?.result) {
                        extractedText = resultEvent.data.result;
                      }
                    }

                    // Task #4977: two stored shapes the extractor did not
                    // understand, both produced by live agent replies.
                    //
                    // (1) A `result` event that reports its payload under
                    // `data.response` instead of `data.result` (the streaming
                    // path already reads `data.response`; the history path
                    // only ever read `data.result`). Preferred over (2): it is
                    // the final answer, not the reasoning that produced it.
                    //
                    // (2) A `message` event whose content carries the answer in
                    // a `thinking` block rather than a `text` block. The
                    // `message` branch above filters to `type === 'text'`
                    // only, so those rows extracted to nothing.
                    //
                    // With neither handled, extraction yielded '' and the raw
                    // event ARRAY fell through to the renderer, which had no
                    // text chunk to show — an empty assistant bubble where the
                    // reply should be. Read them; do not change how they are
                    // stored.
                    if (!extractedText) {
                      const responseEvent = events.find(
                        (e: any) => e?.type === 'result' && typeof e?.data?.response === 'string',
                      );
                      if (responseEvent?.data?.response) {
                        extractedText = responseEvent.data.response;
                      }
                    }

                    if (!extractedText) {
                      for (const e of events as any[]) {
                        if (e?.type !== 'message' && e?.type !== 'assistant') continue;
                        const blocks = e?.data?.content;
                        if (!Array.isArray(blocks)) continue;
                        const thinkingParts = blocks
                          .filter(
                            (c: any) =>
                              c &&
                              (c.type === 'thinking' || c.type === 'redacted_thinking') &&
                              typeof (c.thinking ?? c.text) === 'string',
                          )
                          .map((c: any) => c.thinking ?? c.text)
                          .join('');
                        if (thinkingParts.trim()) {
                          extractedText = thinkingParts;
                          break;
                        }
                      }
                    }

                    if (extractedText) {
                      content = extractedText;
                    } else {
                      console.warn(
                        '[AgentChat] Could not extract text from events:',
                        events.map((e: any) => e.type),
                      );
                    }
                  } catch (e) {
                    console.warn('[AgentChat] Failed to parse assistant message JSON:', e);
                  }
                }

                transformedMessages.push({ role, content });
              }
            }

            if (transformedMessages.length > 0 && isCurrentRequest()) {
              console.log('[AgentChat] Loaded', transformedMessages.length, 'messages from history');
              setMessages(transformedMessages);
            }
          }
        }
      } catch (error) {
        if (!isCurrentRequest()) return;
        console.error('[AgentChat] Failed to load history:', error);
      } finally {
        if (isCurrentRequest()) {
          setIsLoadingHistory(false);
          setHasLoadedHistory(true);
        }
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [spaceId, sessionId, threadId]);

  useEffect(() => {
    // U7: no greeting auto-send and no welcome injection under suppression.
    if (chatSuppressed) return;
    if (!hasLoadedHistory || !isConfigLoaded) return;
    // Task #2198: greeting/welcome only ever fires on the primary thread —
    // a freshly created secondary thread starts clean, no auto-greeting.
    if (!isPrimaryThread) return;

    const hasVisibleMessages = messages.some((m) => {
      if (m.role === 'assistant') return true;
      if (m.role === 'user' && isHiddenChatInstruction(m.content))
        return false;
      return m.role === 'user';
    });
    if (hasVisibleMessages) return;

    const welcomeAlreadyShown =
      welcomeInjectedSourceRef.current !== null ||
      hasWelcomeBeenShown(spaceId, workspaceSessionId);

    if (greetingPrompt && greetingAutoSend && !greetingSentRef.current) {
      if (welcomeAlreadyShown) return;
      if (loading || isSendingRef.current) {
        console.log('[AgentChat] Deferring greeting prompt send — waiting for ready state');
        return;
      }
      markGreetingSent();
      console.log('[AgentChat] Auto-sending greeting prompt to generate AI welcome message');
      const systemMessage = `[SYSTEM: ${greetingPrompt}]`;
      sendMessageWithContent(systemMessage, []);
      return;
    }

    if (greetingSentRef.current && !loading && !welcomeInjectedSourceRef.current) {
      const fallbackTimeout = setTimeout(() => {
        if (greetingSentRef.current && !welcomeInjectedSourceRef.current) {
          const hasAnyAssistant = messages.some((m) => m.role === 'assistant');
          if (hasAnyAssistant) return;
          console.warn(
            '[AgentChat] Greeting prompt sent but no assistant reply arrived — injecting fallback welcome',
          );
          markWelcomeInjected('fallback');
          markWelcomeShown(spaceId, workspaceSessionId);
          const fallbackContent = configWelcomeMessage || 'Hello! How can I help you today?';
          setMessages((prev) => {
            const hasUserMessages = prev.some(
              (m) =>
                m.role === 'user' &&
                !isHiddenChatInstruction(m.content),
            );
            if (hasUserMessages) return prev;
            if (prev.some((m) => m.role === 'assistant')) return prev;
            return [...prev, { role: 'assistant', content: fallbackContent }];
          });
        }
      }, 8000);
      return () => clearTimeout(fallbackTimeout);
    }

    if (greetingSentRef.current) return;

    const currentSource = welcomeInjectedSourceRef.current;

    if (configWelcomeMessage && currentSource !== 'config') {
      if (welcomeAlreadyShown && !currentSource) return;
      if (currentSource) {
        console.log(`[AgentChat] Replacing ${currentSource} welcome with config welcome message`);
      } else {
        console.log('[AgentChat] Injecting welcome message for new user (source: config)');
      }
      markWelcomeInjected('config');
      markWelcomeShown(spaceId, workspaceSessionId);
      setMessages((prev) => {
        const hasUserMessages = prev.some(
          (m) =>
            m.role === 'user' &&
            !isHiddenChatInstruction(m.content),
        );
        if (hasUserMessages) return prev;
        return [{ role: 'assistant', content: configWelcomeMessage }];
      });
      return;
    }

    if (currentSource === 'config') return;

    if (sessionWelcomeMessage && currentSource !== 'session') {
      if (welcomeAlreadyShown && !currentSource) return;
      if (currentSource === 'fallback') {
        console.log('[AgentChat] Replacing hardcoded fallback with session API welcome message');
      } else {
        console.log('[AgentChat] Injecting welcome message for new user (source: session API)');
      }
      markWelcomeInjected('session');
      markWelcomeShown(spaceId, workspaceSessionId);
      setMessages((prev) => {
        const hasUserMessages = prev.some(
          (m) =>
            m.role === 'user' &&
            !isHiddenChatInstruction(m.content),
        );
        if (hasUserMessages) return prev;
        if (prev.length === 0 || (prev.length === 1 && prev[0].role === 'assistant')) {
          return [{ role: 'assistant', content: sessionWelcomeMessage }];
        }
        return prev;
      });
      return;
    }

    if (currentSource) return;

    if (greetingPrompt && greetingAutoSend) return;
    if (!isConfigLoaded) return;
    if (welcomeAlreadyShown) return;

    const timeout = setTimeout(() => {
      if (!welcomeInjectedSourceRef.current && !greetingSentRef.current) {
        console.log(
          '[AgentChat] Injecting welcome message for new user (source: hardcoded fallback after timeout)',
        );
        markWelcomeInjected('fallback');
        markWelcomeShown(spaceId, workspaceSessionId);
        setMessages((prev) => {
          if (prev.length > 0) return prev;
          return [{ role: 'assistant', content: 'Hello! How can I help you today?' }];
        });
      }
    }, 1500);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasLoadedHistory,
    isConfigLoaded,
    configWelcomeMessage,
    sessionWelcomeMessage,
    greetingPrompt,
    greetingAutoSend,
    messages,
    loading,
    workspaceSessionId,
    configToolScope,
    spaceId,
  ]);

  // Auto-scroll to bottom when messages update — uses scrollTop on the
  // overflow container instead of scrollIntoView to avoid scrolling the
  // outer page on iOS Safari mobile.
  //
  // The end-marker is nested inside a max-width wrapper, so its immediate
  // parent is NOT the overflow container — walk up to the nearest scrollable
  // ancestor instead of assuming parentElement scrolls.
  const findScrollContainer = useCallback((): HTMLElement | null => {
    let node: HTMLElement | null = messagesEndRef.current?.parentElement ?? null;
    while (node) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      const scrollable =
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        node.scrollHeight > node.clientHeight;
      if (scrollable) return node;
      // Also accept containers that are scroll-styled but not yet overflowing,
      // so the initial pin works before content finishes expanding.
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  // Whether the view should follow new content. Starts true (pin to bottom on
  // load); flips false when the user deliberately scrolls up, and re-engages
  // when they scroll back near the bottom.
  const autoFollowRef = useRef(true);
  const scrollListenerElRef = useRef<HTMLElement | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = findScrollContainer();
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [findScrollContainer]);

  // Attach a scroll listener to the resolved container so we can tell when
  // the user has scrolled up (disengage auto-follow) or returned near the
  // bottom (re-engage). Re-resolves whenever the message view re-renders,
  // since the container mounts/unmounts with the chat view.
  useEffect(() => {
    const el = findScrollContainer();
    if (!el) return;

    const handleContainerScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      autoFollowRef.current = distanceFromBottom < 80;
    };

    scrollListenerElRef.current = el;
    el.addEventListener('scroll', handleContainerScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleContainerScroll);
      if (scrollListenerElRef.current === el) scrollListenerElRef.current = null;
    };
  }, [messages, streamingContent, loading, hasLoadedHistory, findScrollContainer]);

  useEffect(() => {
    if (autoFollowRef.current) {
      scrollToBottom();
    }
  }, [messages, streamingContent, loading, scrollToBottom]);

  // Initial bottom-pin once history loads: content (markdown, images, cards)
  // can expand after mount, so re-pin over a short window as long as the user
  // hasn't scrolled away.
  useEffect(() => {
    if (!hasLoadedHistory) return;
    autoFollowRef.current = true;
    scrollToBottom();
    const raf = requestAnimationFrame(() => {
      if (autoFollowRef.current) scrollToBottom();
    });
    const timeouts = [150, 400, 900].map((ms) =>
      setTimeout(() => {
        if (autoFollowRef.current) scrollToBottom();
      }, ms),
    );
    return () => {
      cancelAnimationFrame(raf);
      timeouts.forEach(clearTimeout);
    };
  }, [hasLoadedHistory, scrollToBottom]);

  // WebSocket subscription for real-time messages
  useEffect(() => {
    // U7: suppressed contexts open no space-chat WebSocket/stream.
    if (chatSuppressed) return;
    if (!workspaceSessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?session_chat=${workspaceSessionId}`;

    console.log('[AgentChat] Connecting WebSocket with workspace_session.id:', workspaceSessionId);
    console.log('[AgentChat] WebSocket URL:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[AgentChat] WebSocket connected successfully');
      console.log('[AgentChat] Subscribed to workspace_session.id:', workspaceSessionId);
    };

    const processedMessageIds = new Set<string>();

    ws.onmessage = (event) => {
      console.log('[AgentChat] WebSocket event received');
      try {
        const data = JSON.parse(event.data);
        console.log('[AgentChat] WebSocket message type:', data.type);

        if (data.type === 'session_message' && data.message) {
          const incomingThread =
            typeof data.message.threadId === 'string' && data.message.threadId.trim()
              ? data.message.threadId.trim()
              : typeof data.message.metadata?.threadId === 'string' &&
                  data.message.metadata.threadId.trim()
                ? data.message.metadata.threadId.trim()
                : null;
          const currentThread = threadId && threadId.trim() ? threadId.trim() : 'main';
          if (incomingThread) {
            if (incomingThread !== currentThread) {
              console.log('[AgentChat] Skipping WS message for other thread:', incomingThread);
              return;
            }
          } else if (currentThread !== 'main') {
            // Legacy untagged broadcasts are primary-thread messages. Never
            // let one leak into a selected secondary conversation.
            console.log('[AgentChat] Skipping untagged WS message on secondary thread:', threadId);
            return;
          }
          const messageId = data.message.id;

          // The post-stream isSSEActive suppression window exists to dedup
          // same-turn messages already delivered via SSE. When the stream
          // ended WITHOUT any SSE-delivered assistant reply, the WS message
          // IS the awaited reply and must not be dropped — the id/content
          // dedup guards below still apply. (Trello 182365-QH9U8H7W)
          const isAwaitingLateReply =
            awaitingAssistantReplyRef.current &&
            !assistantReplyCommittedRef.current &&
            !isSendingRef.current;
          if (
            data.message.role === 'assistant' &&
            isSSEActiveRef.current &&
            !isAwaitingLateReply
          ) {
            console.log(
              '[AgentChat] Skipping WS assistant message during active SSE stream:',
              messageId,
            );
            return;
          }

          if (messageId && sseMessageIdsRef.current.has(String(messageId))) {
            console.log('[AgentChat] Skipping WS message already received via SSE:', messageId);
            return;
          }

          if (messageId && processedMessageIds.has(messageId)) {
            console.log('[AgentChat] Skipping duplicate message ID:', messageId);
            return;
          }
          if (messageId) {
            processedMessageIds.add(messageId);
          }

          console.log(
            '[AgentChat] Processing message:',
            messageId,
            'contentType:',
            data.message.contentType,
          );

          let content: string | MessageContent[] = data.message.content ?? '';

          if (data.message.contentType === 'json' && Array.isArray(data.message.content)) {
            console.log(
              '[AgentChat] Processing JSON event array with',
              data.message.content.length,
              'events',
            );
            let extractedText = '';

            const resultEvent = data.message.content.find(
              (e: any) => e.type === 'result' && e.data?.response,
            );
            if (resultEvent?.data?.response) {
              extractedText = resultEvent.data.response;
              console.log(
                '[AgentChat] ✓ Extracted from result.response:',
                extractedText.substring(0, 50) + '...',
              );
            }

            if (!extractedText) {
              const messageEvent = data.message.content.find(
                (e: any) => e.type === 'message' && e.data?.content,
              );
              if (messageEvent?.data?.content) {
                const textParts = messageEvent.data.content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('');
                if (textParts) {
                  extractedText = textParts;
                  console.log(
                    '[AgentChat] ✓ Extracted from message.content:',
                    extractedText.substring(0, 50) + '...',
                  );
                }
              }
            }

            if (!extractedText) {
              const textChunks = data.message.content
                .filter((e: any) => e.type === 'text_chunk' && e.data?.text)
                .map((e: any) => e.data.text);

              if (textChunks.length > 0) {
                extractedText = textChunks.join('');
                console.log(
                  '[AgentChat] ✓ Reconstructed from text_chunks:',
                  extractedText.substring(0, 50) + '...',
                );
              }
            }

            if (extractedText) {
              content = extractedText;
            } else {
              console.warn(
                '[AgentChat] ✗ Could not extract text, event types:',
                data.message.content.map((e: any) => e.type),
              );
              return;
            }
          }

          if (!content || (typeof content === 'string' && !content.trim())) {
            console.log('[AgentChat] Skipping empty content message');
            return;
          }

          const newMessage: ChatMessage = {
            role: data.message.role as 'user' | 'assistant',
            content,
          };

          console.log('[AgentChat] ✓ Adding message to UI, role:', newMessage.role);
          if (newMessage.role === 'assistant' && awaitingAssistantReplyRef.current) {
            // The awaited reply landed over the WebSocket — the turn is done.
            assistantReplyCommittedRef.current = true;
            settleTurn();
          }
          setMessages((prev) => {
            // Content-based dedup: skip if the last message has the same
            // role and identical text (covers SSE→WS race window).
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.role === newMessage.role) {
                const lastText = typeof last.content === 'string' ? last.content : '';
                const newText = typeof newMessage.content === 'string' ? newMessage.content : '';
                if (lastText && newText && lastText === newText) {
                  console.log('[AgentChat] Skipping duplicate WS message (content matches last message)');
                  return prev;
                }
              }
            }
            return [...prev, newMessage];
          });
        }
      } catch (e) {
        console.warn('[AgentChat] Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[AgentChat] WebSocket error:', error);
    };

    ws.onclose = (event) => {
      console.log('[AgentChat] WebSocket disconnected:', event.code, event.reason);
    };

    return () => {
      console.log('[AgentChat] Cleaning up WebSocket connection');
      ws.close(1000, 'Component unmounting');
      wsRef.current = null;
    };
  }, [workspaceSessionId, threadId]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 72);
      textarea.style.height = `${newHeight}px`;
    }
  }, [input]);

  // Resume targets are isolated by the visitor/session and thread. A v4 shell
  // remounts this hook when selecting a thread, but sessionStorage itself is
  // shared by every thread in the tab, so a space-only key would resume the
  // wrong Claude transcript after "New conversation".
  const claudeSessionKey = claudeSessionStorageKey(
    spaceId,
    resumeIdentity,
    conversationThreadId,
  );
  const [claudeSessionState, setClaudeSessionState] = useState<{
    key: string;
    id?: string;
  }>(() => ({
    key: claudeSessionKey,
    id: readClaudeSessionId(claudeSessionKey),
  }));
  const claudeSessionId =
    claudeSessionState.key === claudeSessionKey ? claudeSessionState.id : undefined;

  useEffect(() => {
    const stored = readClaudeSessionId(claudeSessionKey);
    setClaudeSessionState((previous) =>
      previous.key === claudeSessionKey && previous.id === stored
        ? previous
        : { key: claudeSessionKey, id: stored },
    );
  }, [claudeSessionKey]);

  const setClaudeSessionId = (id: string) => {
    setClaudeSessionState({ key: claudeSessionKey, id });
    writeClaudeSessionId(claudeSessionKey, id);
  };

  // Helper function to upload files (used by file input, drag-drop, and paste)
  const uploadFiles = async (files: File[]) => {
    // U7: no generic attachment upload under suppression — task attachments
    // go through the parent chrome's task-asset path instead.
    if (chatSuppressed) return;
    if (files.length === 0) return;

    if (pendingAttachments.length + files.length > 5) {
      console.warn('[AgentChat] Too many files - max 5 allowed');
      return;
    }

    const supportedFiles = files.filter(
      (file) => file.type.startsWith('image/') || file.type === 'application/pdf',
    );

    if (supportedFiles.length === 0) {
      console.warn('[AgentChat] No supported files found');
      return;
    }

    setIsUploadingAttachment(true);

    try {
      const formData = new FormData();
      supportedFiles.forEach((file) => {
        formData.append('files', file);
      });

      const res = await fetch(`/api/uploads/attachments?configId=${spaceId}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await res.json();
      setPendingAttachments((prev) => [...prev, ...data.attachments]);
      console.log(`[AgentChat] Uploaded ${data.attachments.length} files`);
    } catch (error: any) {
      console.error('[AgentChat] Upload failed:', error.message);
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(Array.from(files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      await uploadFiles(files);
    }
  };

  // Core send function that takes message content directly
  const sendMessageWithContent = async (
    messageContent: string,
    attachmentsToSend: AttachmentMeta[],
    onAccepted?: () => void,
  ) => {
    if (chatSuppressed) {
      // U7: suppressed contexts never call /space/:spaceId/chat/stream.
      console.log('[AgentChat] Chat is suppressed in this context — send ignored');
      return;
    }
    if ((!messageContent.trim() && attachmentsToSend.length === 0) || loading) return;

    if (!hasLoadedHistory) {
      console.log('[AgentChat] Waiting for history to load before sending...');
      return;
    }
    if (!isConfigLoaded) {
      console.log('[AgentChat] Waiting for agent config refresh before sending...');
      return;
    }

    if (isSendingRef.current) {
      console.log(`[AgentChat] Ignoring duplicate API call - already sending (ref)`);
      return;
    }

    // Reacquire from the map at send time: an idle guard may have been
    // collected after this render, while this callback still closes over the
    // old object.
    const guard = getSendingGuard(conversationKey);
    const now = Date.now();
    const timeSinceLastSend = now - guard.lastSentAt;
    if (timeSinceLastSend < SEND_COOLDOWN_MS) {
      console.log(`[AgentChat] Ignoring duplicate API call - sent ${timeSinceLastSend}ms ago`);
      return;
    }
    if (guard.active) {
      console.log('[AgentChat] Ignoring duplicate API call - this conversation is already sending');
      return;
    }

    console.log(`[AgentChat] Sending message, acquiring locks`);
    const turnOwner = {};
    if (guard.cleanupTimer) {
      clearTimeout(guard.cleanupTimer);
      guard.cleanupTimer = undefined;
    }
    isSendingRef.current = true;
    guard.active = true;
    guard.owner = turnOwner;
    activeSendingGuardRef.current = guard;
    activeSendingGuardKeyRef.current = conversationKey;
    activeTurnOwnerRef.current = turnOwner;
    guard.lastSentAt = now;
    try {
      onAccepted?.();
    } catch (error) {
      console.error('[AgentChat] Send acceptance callback failed:', error);
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: messageContent,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setLastAction(undefined);
    // A new turn starts awaiting its assistant reply; `loading` stays on
    // until that reply is committed to the transcript (SSE or late WS).
    awaitingAssistantReplyRef.current = true;
    assistantReplyCommittedRef.current = false;
    clearReplyStallTimer();

    // Let the shell know a real visitor message landed in this thread so it
    // can auto-title the conversation. Hidden auto-greeting instructions are
    // user-shaped only for transport and must never become customer-facing.
    if (!isHiddenChatInstruction(messageContent)) {
      try {
        window.dispatchEvent(new CustomEvent('audos:chat-user-message', {
          detail: { threadId: threadId || 'main', content: messageContent },
        }));
      } catch (e) {}
    }

    trackEvent('agent_message', {
      messageLength: messageContent.length,
      messagePreview: messageContent.slice(0, 50),
      attachmentCount: attachmentsToSend.length,
    });

    isSSEActiveRef.current = true;
    const controller = new AbortController();
    const turnGeneration = ++streamGenerationRef.current;
    const turnIsCurrent = () =>
      mountedRef.current && streamGenerationRef.current === turnGeneration;
    abortControllerRef.current = controller;
    userStoppedStreamRef.current = false;
    // Hoisted above the try so the AbortError catch can flush any partial
    // assistant text that streamed before the user hit stop.
    let accumulatedText = '';
    partialStreamTextRef.current = '';
    try {
      const email = getSessionEmail();
      console.log(
        '[AgentChat] Sending message with email:',
        email,
        'attachments:',
        attachmentsToSend.length,
      );

      const res = await fetch(`/api/space/${spaceId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageContent,
          sessionId: sessionId,
          claudeSessionId: claudeSessionId,
          email: email,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
          threadId: threadId || undefined,
          threadTitle: threadTitle || undefined,
          ...(configToolScope !== undefined ? { toolScope: configToolScope } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;
      let totalTextLength = 0;
      accumulatedText = '';

      console.log('[SPACE-STREAM-DEBUG] Starting to read SSE stream...');

      while (true) {
        const { done, value } = await reader.read();
        if (!turnIsCurrent() || controller.signal.aborted) return;
        if (done) {
          console.log(
            '[SPACE-STREAM-DEBUG] Stream ended. Total chunks:',
            chunkCount,
            'Total text length:',
            totalTextLength,
          );
          break;
        }

        const rawChunk = decoder.decode(value, { stream: true });
        console.log('[SPACE-STREAM-DEBUG] Raw chunk received, length:', rawChunk.length, 'bytes');

        buffer += rawChunk;
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!turnIsCurrent() || controller.signal.aborted) return;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('[SPACE-STREAM-DEBUG] Received [DONE] signal');
              setStreamingContent('');
              continue;
            }

            try {
              const event = JSON.parse(data);
              console.log(
                '[SPACE-STREAM-DEBUG] Event type:',
                event.type,
                'timestamp:',
                event.timestamp,
              );

              if (event.type === 'streaming_message_init' && event.data?.messageId) {
                sseMessageIdsRef.current.add(String(event.data.messageId));
              } else if (event.type === 'text_chunk') {
                chunkCount++;
                const text = event.data?.text || '';
                totalTextLength += text.length;
                accumulatedText += text;
                partialStreamTextRef.current = accumulatedText;
                console.log(
                  '[SPACE-STREAM-DEBUG] text_chunk #' + chunkCount + ':',
                  text.substring(0, 50),
                  '(' + text.length + ' chars)',
                );
                flushSync(() => {
                  setIsStreaming(true);
                  setStreamingContent((prev) => prev + text);
                });
                await new Promise((resolve) => requestAnimationFrame(resolve));
              } else if (event.type === 'message') {
                setIsStreaming(false);
                setStreamingContent('');
                const msgContent = event.data?.content ?? '';
                if (event.data?.role === 'assistant') {
                  assistantReplyCommittedRef.current = true;
                }
                setMessages((prev) => [...prev, { ...event.data, content: msgContent }]);

                if (Array.isArray(event.data?.content)) {
                  for (const chunk of event.data.content) {
                    if (chunk.type === 'tool_use') {
                      setIsStreaming(false);
                      setStreamingContent('');
                      setLastAction(chunk.name);

                      if (chunk.name === 'read_file' && chunk.input?.file_path) {
                        onFileAccess?.({
                          timestamp: Date.now(),
                          path: chunk.input.file_path,
                          action: 'read',
                          tool: 'read_file',
                        });
                      } else if (chunk.name === 'write_file' && chunk.input?.file_path) {
                        onFileAccess?.({
                          timestamp: Date.now(),
                          path: chunk.input.file_path,
                          action: 'write',
                          tool: 'write_file',
                        });
                      }
                    }
                  }
                }
              } else if (event.type === 'progress') {
                if (event.data?.message) {
                  setIsStreaming(false);
                  setLastAction(event.data.message);
                }
                if (event.data?.sessionId) {
                  setClaudeSessionId(event.data.sessionId);
                }
              } else if (event.type === 'result') {
                setIsStreaming(false);
                setLastAction(undefined);
                if (event.data?.sessionId) {
                  setClaudeSessionId(event.data.sessionId);
                }
                if (event.data?.assistantReplySuppressed === true) {
                  setStreamingContent('');
                  settleTurn();
                } else if (assistantReplyCommittedRef.current) {
                  // The reply already landed via SSE message events — done.
                  settleTurn();
                }
                // Otherwise the committed assistant message is still on its
                // way over the WebSocket (`session_message`) — keep the
                // thinking indicator until it lands. The stall timer armed in
                // `finally` bounds the wait.
              } else if (event.type === 'error') {
                throw new Error(
                  event.data?.error || 'The reply was interrupted. Please try again.',
                );
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.warn('Failed to parse event:', data);
                continue;
              }
              throw e;
            }
          }
        }
      }
    } catch (err: any) {
      if (!turnIsCurrent()) return;
      if (err?.name === 'AbortError') {
        if (userStoppedStreamRef.current) {
          console.log('[AgentChat] Stream aborted by user');
          commitInterruptedTurn(accumulatedText, { silent: true });
        } else {
          console.error('[AgentChat] Stream aborted unexpectedly');
          commitInterruptedTurn(accumulatedText);
        }
      } else {
        console.error('Chat error:', err);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Sorry, I encountered an error. Please try again.`,
          },
        ]);
        settleTurn();
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (guard.owner !== turnOwner) return;
      releaseSendingGuard(conversationKey, guard, turnOwner);
      activeTurnOwnerRef.current = undefined;
      activeSendingGuardRef.current = undefined;
      activeSendingGuardKeyRef.current = undefined;
      if (!turnIsCurrent()) return;
      setIsStreaming(false);
      setLastAction(undefined);
      isSendingRef.current = false;
      if (awaitingAssistantReplyRef.current && !assistantReplyCommittedRef.current) {
        // The stream ended without the assistant reply being committed — the
        // server delivers it later over the WebSocket `session_message` path.
        // Keep any partial tokens on screen while we wait; clearing the
        // bubble here is what made mid-stream drops look like a vanish.
        if (!partialStreamTextRef.current) {
          setStreamingContent('');
        }
        armReplyStallTimer();
      } else {
        setStreamingContent('');
        settleTurn();
      }
      // Delay clearing isSSEActiveRef so that any WS broadcast of the same
      // assistant turn (sent by the server's finally block) is still
      // suppressed by the WS handler's isSSEActiveRef guard.
      setTimeout(() => {
        isSSEActiveRef.current = false;
      }, 2000);
    }
  };

  // Pending launcher messages are independent chat turns. Claim only after the
  // send guards and locks accept the turn, and never borrow composer state.
  useEffect(() => {
    if (pendingMessageRetryTimerRef.current) {
      clearTimeout(pendingMessageRetryTimerRef.current);
      pendingMessageRetryTimerRef.current = null;
    }

    if (!pendingMessage) {
      pendingMessageClaimedRef.current = false;
      return;
    }
    if (
      pendingMessageClaimedRef.current ||
      chatSuppressed ||
      !hasLoadedHistory ||
      !isConfigLoaded
    ) return;

    const scheduleRetry = (delayMs: number) => {
      pendingMessageRetryTimerRef.current = setTimeout(() => {
        pendingMessageRetryTimerRef.current = null;
        setPendingMessageRetryNonce((nonce) => nonce + 1);
      }, Math.max(1, delayMs));
    };

    if (loading || isSendingRef.current || sendingGuard.active) {
      scheduleRetry(100);
    } else {
      const cooldownRemaining = SEND_COOLDOWN_MS - (Date.now() - sendingGuard.lastSentAt);
      if (cooldownRemaining > 0) {
        scheduleRetry(cooldownRemaining + 1);
      } else {
        sendMessageWithContent(pendingMessage, [], () => {
          pendingMessageClaimedRef.current = true;
          onPendingMessageConsumed?.();
        });
      }
    }

    return () => {
      if (pendingMessageRetryTimerRef.current) {
        clearTimeout(pendingMessageRetryTimerRef.current);
        pendingMessageRetryTimerRef.current = null;
      }
    };
    // sendMessageWithContent is deliberately called from the render whose
    // readiness values triggered this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingMessage,
    loading,
    hasLoadedHistory,
    isConfigLoaded,
    chatSuppressed,
    onPendingMessageConsumed,
    pendingMessageRetryNonce,
  ]);

  const abortStream = () => {
    userStoppedStreamRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (awaitingAssistantReplyRef.current) {
      // Stop must release immediately even if the fetch abort is slow to
      // surface — keep any partial tokens and skip the retry prompt.
      commitInterruptedTurn(partialStreamTextRef.current, { silent: true });
    }
  };

  const sendMessage = async () => {
    if (
      (!input.trim() && pendingAttachments.length === 0) ||
      loading ||
      !isConfigLoaded
    ) return;
    const messageToSend = input;
    const attachmentsToSend = [...pendingAttachments];
    setInput('');
    setPendingAttachments([]);
    await sendMessageWithContent(messageToSend, attachmentsToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !loading) {
      e.preventDefault();
      sendMessage();
    }
  };

  const shortcutPrefix =
    typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';

  return {
    spaceId,
    sessionId,

    messages,
    // Task #4977: see the `setMessages` note on AgentChatRuntime — tenant
    // chat views append to the conversation through this setter.
    setMessages,
    streamingContent,
    isStreaming,
    loading,
    lastAction,
    isLoadingHistory,
    hasLoadedHistory,

    input,
    setInput,
    pendingAttachments,
    isUploadingAttachment,
    isDraggingOver,

    messagesEndRef,
    textareaRef,
    fileInputRef,
    dropZoneRef,

    abortStream,
    sendMessage,
    sendMessageWithContent,
    removeAttachment,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    handleKeyDown,

    configWelcomeMessage,
    greetingPrompt: greetingAutoSend ? greetingPrompt : null,
    isConfigLoaded,
    greetingSent,
    welcomeInjectedSource,

    isBeaconSpace,
    agentLabel,
    thinkingText: effectiveThinkingText,
    beaconIntake,
    beaconStarterPrompts: BEACON_STARTER_PROMPTS,
    starterPrompts: configStarterPrompts,
    shortcutPrefix,
  };
}

export default useAgentChatRuntime;
