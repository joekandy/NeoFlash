import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { SpaceConfig } from '@shared/schema';

export type SpaceMode = 'entrepreneur' | 'customer';

export interface FileInfo {
  path: string;
  size: number;
  isDirectory: boolean;
}

/**
 * Subscription state fetched from /api/space/:spaceId/subscription-status.
 * CRM contact metadata is the single source of truth.
 *
 * planTier: The workspace-specific plan identifier (e.g., "essentials", "companion", "guide").
 *   - Set via Stripe subscription metadata, manual CRM override, or direct metadata update.
 *   - null when the contact has no explicit plan set (workspace app should apply its own default).
 *   - Workspace apps that define custom tiers in lib/plans.ts should check planTier
 *     against their own tier definitions for app access gating.
 */
export interface SubscriptionState {
  status: 'loading' | 'not_registered' | 'registered' | 'trial' | 'trialing' | 'trial_expired' | 'active' | 'canceled' | 'past_due' | 'incomplete';
  planTier: string | null;
  email: string | null;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  trialDaysRemaining: number;
  trialDays: number;
  trialExpired: boolean;
  hasPaymentMethod: boolean;
  contactId: string | null;
  manualOverride: { tier: string; grantedBy: string; reason: string; expiresAt: string | null } | null;
}

interface SpaceRuntimeContextValue {
  mode: SpaceMode;
  spaceId: string;
  sessionId?: string;
  setSessionId: (sessionId: string) => void;
  visitorId?: string;
  isBootstrappingSession: boolean;
  
  config: SpaceConfig | null;
  isLoading: boolean;
  error: Error | null;
  
  readFile: (path: string) => Promise<string>;
  readTemplateFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  listFiles: (dirPath?: string) => Promise<FileInfo[]>;
  
  trackEvent: (eventType: string, metadata?: Record<string, any>) => Promise<void>;
  
  refetchConfig: () => Promise<void>;

  subscription: SubscriptionState | null;
  subscriptionReady: boolean;
  updateSubscription: (updates: Partial<SubscriptionState>) => void;
  refreshSubscription: () => Promise<void>;
  checkAppAccess: (requiredTier?: string) => boolean;

  sessionMetadata: Record<string, unknown>;
  userRole: string | null;
  checkRoleAccess: (allowedRoles?: string[]) => boolean;
}

const SpaceRuntimeContext = createContext<SpaceRuntimeContextValue | null>(null);

interface SpaceRuntimeProviderProps {
  children: ReactNode;
  spaceId: string;
  mode?: SpaceMode;
  sessionId?: string;
  config?: SpaceConfig | null; // Optional pre-loaded config
}

// Get or create persistent visitor ID from cookie (same as landing pages for cross-site tracking)
const VISITOR_COOKIE = 'audos_vid';

// ---------------------------------------------------------------------------
// Safe web-storage access (Trello 182365-45NQXG5C / 182365-5SA2TXCD).
//
// iOS Safari private mode, storage-blocked enterprise browsers, and sandboxed
// iframes can throw on ANY localStorage touch (SecurityError on read/write,
// QuotaExceededError on write). Every storage access in this file must go
// through these helpers so a storage-throw browser degrades to "no
// persistence" instead of crashing the page — critically, this must hold
// right AFTER a visitor successfully registers.
//
// When localStorage is unusable, values land in a tab-scoped in-memory
// fallback shared across the bundle via `window.__audosSafeStorageMemory__`
// (EmailGate, SpaceRuntimeContext, and Desktop each ship a copy of these
// helpers but must observe each other's writes — e.g. the session EmailGate
// stores after a successful registration must satisfy setSessionId's
// stored-session authorization check below). The session then lives for the
// lifetime of the tab via React state + this fallback, and the visitor simply
// re-registers on their next visit.
// ---------------------------------------------------------------------------
function storageMemoryFallback(): Map<string, string> {
  if (typeof window === 'undefined') return new Map<string, string>();
  const w = window as Window & { __audosSafeStorageMemory__?: Map<string, string> };
  if (!w.__audosSafeStorageMemory__) {
    w.__audosSafeStorageMemory__ = new Map<string, string>();
  }
  return w.__audosSafeStorageMemory__;
}

function safeStorageGet(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // Storage read threw — fall through to the in-memory fallback.
  }
  const fallback = storageMemoryFallback().get(key);
  return fallback === undefined ? null : fallback;
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    storageMemoryFallback().delete(key);
    return;
  } catch {
    // Not persistable (private mode / quota / security policy) — keep the
    // value for this tab only.
  }
  storageMemoryFallback().set(key, value);
}

function safeStorageRemove(key: string): void {
  storageMemoryFallback().delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}

function getPaymentAppId(spaceId: string) {
  const runtimeWindow = window as Window & {
    __APP_ID__?: string;
    __SPACE_ID__?: string;
  };
  return runtimeWindow.__APP_ID__ || runtimeWindow.__SPACE_ID__ || spaceId;
}

function readVerifiedStoredSession(
  sessionKey: string,
): { email: string | null; sessionId: string; identityMode: string | null } | null {
  try {
    const stored = safeStorageGet(sessionKey);
    if (!stored) return null;
    const session = JSON.parse(stored);
    const sessionId =
      session.workspaceSessionId || session.sessionId || session.id;
    const isLegacyCandidate =
      session.authorized === true &&
      session.identityMode === 'legacy_registration';
    if (
      (session.verified !== true && !isLegacyCandidate) ||
      typeof sessionId !== 'string' ||
      !sessionId.startsWith('wses_')
    ) {
      return null;
    }
    const email =
      typeof session.email === 'string' && session.email.trim()
        ? session.email.trim().toLowerCase()
        : null;
    // Task 4379: preserve the stored identity mode so remembered-session
    // revalidation can keep a legacy-registration session alive only when the
    // server /check-session confirms it (authorized + legacy_registration).
    const identityMode =
      typeof session.identityMode === 'string' ? session.identityMode : null;
    return { email, sessionId, identityMode };
  } catch {
    return null;
  }
}

function readStoredGuestSessionId(sessionKey: string): string | null {
  try {
    const stored = safeStorageGet(sessionKey);
    if (!stored) return null;
    const session = JSON.parse(stored);
    const sessionId =
      session.workspaceSessionId || session.sessionId || session.id;
    return session.isGuest === true &&
      typeof sessionId === 'string' &&
      sessionId.startsWith('guest_')
      ? sessionId
      : null;
  } catch {
    return null;
  }
}

function readStoredRuntimeSessionId(sessionKey: string): string | null {
  return (
    readVerifiedStoredSession(sessionKey)?.sessionId ||
    readStoredGuestSessionId(sessionKey)
  );
}

function hasStoredRuntimeSession(sessionKey: string): boolean {
  return safeStorageGet(sessionKey) !== null;
}

// Task #4413 — presented-id -> canonical `wses_` id, learned from the server's
// /check-session response. A verified stable-uuid session is valid on the data
// plane, but adopting the canonical id keeps every write stamped in one form.
const canonicalDataSessionIds: Record<string, string> = {};

function rememberCanonicalDataSessionId(
  presentedId: string,
  canonicalId: unknown,
): void {
  if (
    typeof canonicalId === 'string' &&
    canonicalId.startsWith('wses_') &&
    presentedId &&
    presentedId !== canonicalId
  ) {
    canonicalDataSessionIds[presentedId] = canonicalId;
  }
}

function syncWorkspaceDataSession(sessionId: string | undefined): void {
  if (typeof window === 'undefined') return;
  const runtimeWindow = window as Window & {
    __audosAcceptedSessionId?: string;
    __workspaceDb?: { setSessionId?: (id: string | null) => void };
  };
  // Task #4413 — map a stable-uuid session to its server-confirmed canonical
  // `wses_` id instead of silently dropping it.
  const mapped = sessionId
    ? canonicalDataSessionIds[sessionId] || sessionId
    : undefined;
  const accepted =
    mapped?.startsWith('wses_') || mapped?.startsWith('guest_')
      ? mapped
      : undefined;
  if (accepted) {
    runtimeWindow.__audosAcceptedSessionId = accepted;
  } else {
    delete runtimeWindow.__audosAcceptedSessionId;
  }
  try {
    runtimeWindow.__workspaceDb?.setSessionId?.(accepted || null);
  } catch {}
}

function notifyWorkspaceDataSessionCleared(): void {
  if (typeof window === 'undefined') return;
  syncWorkspaceDataSession(undefined);
  try {
    window.dispatchEvent(new CustomEvent('audos:session-cleared'));
  } catch {}
}

// Comprehensive list of second-level TLDs (country-code SLDs) that require 3-part domain
const MULTI_LEVEL_TLDS = [
  // UK
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'sch.uk',
  // Anguilla (.ai is treated as standard TLD but some registrars use second-level)
  'com.ai', 'net.ai', 'org.ai', 'off.ai',
  // Australia  
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  // New Zealand
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz', 'geek.nz', 'gen.nz',
  // Brazil
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br',
  // Japan
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp',
  // India
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  // Singapore
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  // South Africa
  'co.za', 'org.za', 'web.za', 'net.za', 'gov.za',
  // Mexico
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  // South Korea
  'co.kr', 'or.kr', 'ne.kr', 'ac.kr', 'go.kr',
  // Hong Kong
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  // Taiwan
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
  // China
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'ac.cn', 'edu.cn',
  // Germany (special)
  'co.de',
  // USA state-level
  'co.us', 'k12.us', 'ci.us', 'state.us',
  // Other common ones
  'com.tr', 'org.tr', 'net.tr', 'biz.tr', 'gov.tr',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'com.ar', 'org.ar', 'net.ar', 'gov.ar',
  'com.pl', 'org.pl', 'net.pl', 'gov.pl',
  'com.pt', 'org.pt', 'net.pt', 'gov.pt',
  'co.id', 'or.id', 'go.id', 'ac.id', 'sch.id',
  'co.th', 'or.th', 'ac.th', 'go.th',
  'com.ph', 'org.ph', 'net.ph', 'gov.ph',
  'com.my', 'org.my', 'net.my', 'gov.my', 'edu.my',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn',
  // Platform/hosting domains in Public Suffix List (browsers block cookies on root)
  'replit.dev', 'replit.app', 'repl.co',
  'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
  'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
  'fly.dev', 'deno.dev', 'glitch.me'
];

// Platform domains where we should NOT set a cross-subdomain cookie (Safari ITP blocks it)
const PLATFORM_DOMAINS = [
  'replit.dev', 'replit.app', 'repl.co',
  'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
  'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
  'fly.dev', 'deno.dev', 'glitch.me'
];

function isPlatformDomain(hostname: string): boolean {
  for (const platform of PLATFORM_DOMAINS) {
    if (hostname.endsWith('.' + platform) || hostname === platform) {
      return true;
    }
  }
  return false;
}

function getVisitorId(): string {
  if (typeof document === 'undefined') return '';
  
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(VISITOR_COOKIE + '=')) {
      const value = cookie.substring(VISITOR_COOKIE.length + 1);
      console.log('[SpaceRuntime] Found existing visitor ID:', value);
      return value;
    }
  }
  
  // Create new visitor ID and set cookie for 1 year
  const visitorId = 'vid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  
  // Determine cookie domain for cross-subdomain tracking
  const hostname = window.location.hostname;
  let cookieDomain = '';
  
  // Skip domain for localhost, IP addresses, AND platform domains (Safari ITP compatibility)
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
  const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  const isPlatform = isPlatformDomain(hostname);
  
  // For platform domains (like replit.dev), DON'T set a domain - use host-only cookie
  // Safari ITP blocks JavaScript-set cookies with cross-subdomain domain settings
  if (!isLocalhost && !isIP && !isPlatform) {
    const domainParts = hostname.split('.');
    const lastTwo = domainParts.slice(-2).join('.');
    
    // Check if this is a multi-level TLD requiring 3-part domain
    if (MULTI_LEVEL_TLDS.includes(lastTwo) && domainParts.length >= 3) {
      cookieDomain = '; domain=.' + domainParts.slice(-3).join('.');
    } else if (domainParts.length >= 2) {
      // For standard TLDs like example.com, example.io, example.app
      cookieDomain = '; domain=.' + domainParts.slice(-2).join('.');
    }
  }
  
  // Set cookie with SameSite=Lax for Safari ITP compatibility
  const isSecure = window.location.protocol === 'https:';
  const secureFlag = isSecure ? '; Secure' : '';
  const cookieString = VISITOR_COOKIE + '=' + visitorId + '; expires=' + expires.toUTCString() + '; path=/' + cookieDomain + '; SameSite=Lax' + secureFlag;
  document.cookie = cookieString;
  console.log('[SpaceRuntime] Created new visitor ID:', visitorId, 'domain:', cookieDomain || '(host-only)', 'isPlatform:', isPlatform, 'cookie:', cookieString);
  return visitorId;
}

function sessionCheckUrl(
  spaceId: string,
  workspaceId: string,
  sessionUuid: string,
): string {
  const sharedSpacePath = `/space/${encodeURIComponent(spaceId)}`;
  if (window.location.pathname === sharedSpacePath) {
    return `${sharedSpacePath}/check-session?sessionUuid=${encodeURIComponent(sessionUuid)}`;
  }
  const params = new URLSearchParams({ workspaceId, spaceId, sessionUuid });
  return `/api/auth/otp/space/check-session?${params.toString()}`;
}

export function SpaceRuntimeProvider({ 
  children, 
  spaceId, 
  mode = 'customer',
  sessionId: initialSessionId,
  config: initialConfig = null
}: SpaceRuntimeProviderProps) {
  const [config, setConfig] = useState<SpaceConfig | null>(initialConfig);
  const [isLoading, setIsLoading] = useState(!initialConfig);
  const [error, setError] = useState<Error | null>(null);
  const [sessionId, setSessionIdRaw] = useState<string | undefined>(() => {
    // `?as=visitor` preview: stay logged-out regardless of any stored session,
    // and do not fall back to an ephemeral id (which would suppress the gate).
    if (
      typeof window !== 'undefined' &&
      (window as any).__AUDOS_FORCE_VISITOR__ === true
    ) {
      syncWorkspaceDataSession(undefined);
      return undefined;
    }
    if (mode !== 'customer') {
      const storedSessionId = readStoredRuntimeSessionId(
        `space_session_${spaceId}`,
      );
      const resolved =
        initialSessionId === storedSessionId
          ? initialSessionId
          : storedSessionId || undefined;
      syncWorkspaceDataSession(resolved);
      return resolved;
    }
    const resolved =
      typeof initialSessionId === 'string' &&
      initialSessionId.startsWith('wses_')
        ? initialSessionId
        : readStoredGuestSessionId(`space_session_${spaceId}`) || undefined;
    syncWorkspaceDataSession(resolved);
    return resolved;
  });
  const [visitorId] = useState<string>(() => getVisitorId());
  const [isBootstrappingSession, setIsBootstrappingSession] = useState<boolean>(() => {
    if (typeof window === 'undefined' || mode !== 'customer') return false;
    if ((window as any).__AUDOS_FORCE_VISITOR__ === true) return false;
    if (
      typeof initialSessionId === 'string' &&
      initialSessionId.startsWith('wses_')
    ) {
      return false;
    }
    if (readStoredGuestSessionId(`space_session_${spaceId}`)) return false;
    return hasStoredRuntimeSession(`space_session_${spaceId}`);
  });
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [subscriptionReady, setSubscriptionReady] = useState(false);
  const subscriptionRef = useRef<SubscriptionState | null>(null);
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, unknown>>(() => {
    try {
      const stored = safeStorageGet(`space_session_${spaceId}`);
      if (stored) {
        const session = JSON.parse(stored);
        if (session.metadata && typeof session.metadata === 'object') {
          return session.metadata;
        }
      }
    } catch {}
    return {};
  });

  const setSessionId = useCallback((newSessionId: string) => {
    if (
      newSessionId !== '' &&
      readStoredRuntimeSessionId(`space_session_${spaceId}`) !== newSessionId
    ) {
      console.warn('[SpaceRuntime] Refused an unverified session update');
      return;
    }
    setSessionIdRaw(newSessionId);
    syncWorkspaceDataSession(newSessionId || undefined);
    try {
      const stored = safeStorageGet(`space_session_${spaceId}`);
      if (stored) {
        const session = JSON.parse(stored);
        if (session.metadata && typeof session.metadata === 'object') {
          setSessionMetadata(session.metadata);
        }
      }
    } catch {}
  }, [spaceId]);

  useEffect(() => {
    syncWorkspaceDataSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || mode !== 'customer') return;
    if ((window as any).__AUDOS_FORCE_VISITOR__ === true) return;
    if (
      typeof initialSessionId === 'string' &&
      initialSessionId.startsWith('wses_')
    ) {
      return;
    }

    const sessionKey = `space_session_${spaceId}`;
    if (readStoredGuestSessionId(sessionKey)) return;

    const clearRememberedSession = () => {
      safeStorageRemove(sessionKey);
      setSessionIdRaw(undefined);
      setSessionMetadata({});
      notifyWorkspaceDataSessionCleared();
      setIsBootstrappingSession(false);
    };

    if (!hasStoredRuntimeSession(sessionKey)) {
      setIsBootstrappingSession(false);
      return;
    }

    const remembered = readVerifiedStoredSession(sessionKey);
    const workspaceId = (window as any).__WORKSPACE_ID__;
    if (
      !remembered?.email ||
      typeof workspaceId !== 'string' ||
      !workspaceId
    ) {
      clearRememberedSession();
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    setSessionIdRaw(undefined);
    syncWorkspaceDataSession(undefined);
    setIsBootstrappingSession(true);

    void fetch(
      sessionCheckUrl(spaceId, workspaceId, remembered.sessionId),
      { credentials: 'include', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Session verification failed: ${response.status}`);
        }
        return response.json();
      })
      .then((checkData) => {
        if (cancelled) return;
        const checkedEmail =
          typeof checkData.email === 'string'
            ? checkData.email.trim().toLowerCase()
            : '';
        // Task 4379: a remembered legacy-registration session is preserved only
        // when the server /check-session returns authorized:true AND
        // identityMode:'legacy_registration'. Every other remembered session
        // keeps the strict verified:true behavior. In both cases the server's
        // email must match the stored (normalized) email; authorization is
        // never inferred client-side.
        const serverAuthorizedLegacy =
          checkData.success === true &&
          checkData.authorized === true &&
          checkData.identityMode === 'legacy_registration';
        const serverVerified =
          checkData.success === true && checkData.verified === true;
        const accepted =
          remembered.identityMode === 'legacy_registration'
            ? serverAuthorizedLegacy
            : serverVerified;
        if (!accepted || checkedEmail !== remembered.email) {
          clearRememberedSession();
          return;
        }

        // Task #4413 — adopt the canonical wses_ id for data-plane calls.
        rememberCanonicalDataSessionId(
          remembered.sessionId,
          checkData.canonicalSessionId,
        );
        syncWorkspaceDataSession(remembered.sessionId);
        setSessionIdRaw(remembered.sessionId);
        try {
          window.dispatchEvent(
            new CustomEvent('audos:session-established', {
              detail: {
                workspaceSessionId: remembered.sessionId,
                email: remembered.email,
                verified: checkData.verified === true,
                authorized: checkData.authorized === true,
                identityMode: checkData.identityMode,
              },
            }),
          );
        } catch {}
        setIsBootstrappingSession(false);
      })
      .catch(() => {
        if (!cancelled) clearRememberedSession();
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [initialSessionId, mode, spaceId]);

  // Adopt only an explicitly verified canonical session or a guest marker.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSessionEstablished = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const resumedSessionId =
        detail.workspaceSessionId || detail.sessionId || detail.id;
      if (!resumedSessionId || typeof resumedSessionId !== 'string') return;
      const verifiedCanonical =
        detail.verified === true && resumedSessionId.startsWith('wses_');
      const guestSession =
        detail.isGuest === true && resumedSessionId.startsWith('guest_');
      if (!verifiedCanonical && !guestSession) return;
      if ((window as any).__audosAcceptedSessionId !== resumedSessionId) {
        console.warn(
          '[SpaceRuntime] Ignored session event without an accepted tab identity',
        );
        return;
      }
      if (resumedSessionId === sessionId) return;
      console.log(
        '[SpaceRuntime] audos:session-established → adopting resumed sessionId:',
        resumedSessionId,
      );
      setSessionId(resumedSessionId);
    };
    window.addEventListener('audos:session-established', onSessionEstablished);
    return () =>
      window.removeEventListener('audos:session-established', onSessionEstablished);
  }, [sessionId, setSessionId]);

  const resolveSessionId = (): string | undefined => {
    if (sessionId) return sessionId;
    const acceptedId =
      typeof window !== 'undefined'
        ? (window as any).__audosAcceptedSessionId
        : undefined;
    const recoveredId =
      (typeof acceptedId === 'string' ? acceptedId : null) ||
      readStoredGuestSessionId(`space_session_${spaceId}`);
    if (recoveredId) {
      setSessionId(recoveredId);
      return recoveredId;
    }
    return undefined;
  };

  const getApiBasePath = () => {
    if (mode === 'entrepreneur') {
      return `/api/space/${spaceId}`;
    }
    const resolvedId = resolveSessionId();
    if (!resolvedId) {
      throw new Error('Session not initialized - cannot perform file operations without login');
    }
    return `/api/space/${spaceId}/user/${resolvedId}`;
  };

  // Load space config
  const fetchConfig = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/space/${spaceId}/config`);
      
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.statusText}`);
      }
      
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      setError(err as Error);
      console.error('[SpaceRuntime] Config load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial config load (only if not pre-loaded)
  useEffect(() => {
    if (!initialConfig) {
      fetchConfig();
    }
  }, [spaceId]);

  // Validate path security - multiple layers
  const validatePath = (logicalPath: string): void => {
    // Security layer 1: Prevent path traversal with ..
    if (logicalPath.includes('..')) {
      throw new Error('Invalid path: path traversal detected');
    }
    
    // Security layer 2: Reject absolute paths (/, //, etc.)
    if (logicalPath.startsWith('/')) {
      throw new Error('Invalid path: absolute paths not allowed');
    }
    
    // Security layer 3: Reject protocol-prefixed paths
    if (logicalPath.includes(':')) {
      throw new Error('Invalid path: protocol-prefixed paths not allowed');
    }
    
    // Security layer 4: Reject backslashes (Windows path separators)
    if (logicalPath.includes('\\')) {
      throw new Error('Invalid path: backslashes not allowed');
    }
  };

  // Storage operations with mode-aware routing
  const readFile = async (logicalPath: string): Promise<string> => {
    validatePath(logicalPath);
    
    try {
      const apiPath = `${getApiBasePath()}/file/${logicalPath}`;
      const response = await fetch(apiPath);
      
      if (!response.ok) {
        // Return empty object for non-existent files (initial state)
        if (response.status === 404) {
          return JSON.stringify({});
        }
        throw new Error(`Failed to read file: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.content || '';
    } catch (err) {
      console.error('[SpaceRuntime] Read file error:', logicalPath, err);
      throw err;
    }
  };

  const readTemplateFile = async (logicalPath: string): Promise<string> => {
    validatePath(logicalPath);
    
    try {
      const apiPath = `/api/space/${spaceId}/file/${logicalPath}`;
      const response = await fetch(apiPath);
      
      if (!response.ok) {
        if (response.status === 404) {
          return JSON.stringify({});
        }
        throw new Error(`Failed to read template file: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.content || '';
    } catch (err) {
      console.error('[SpaceRuntime] Read template file error:', logicalPath, err);
      throw err;
    }
  };

  const writeFile = async (logicalPath: string, content: string): Promise<void> => {
    validatePath(logicalPath);
    
    try {
      const apiPath = `${getApiBasePath()}/file/${logicalPath}`;
      const response = await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.statusText}`);
      }
    } catch (err) {
      console.error('[SpaceRuntime] Write file error:', logicalPath, err);
      throw err;
    }
  };

  const listFiles = async (dirPath: string = ''): Promise<FileInfo[]> => {
    try {
      const apiPath = `${getApiBasePath()}/files${dirPath ? `?path=${dirPath}` : ''}`;
      const response = await fetch(apiPath);
      
      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.files || [];
    } catch (err) {
      console.error('[SpaceRuntime] List files error:', dirPath, err);
      throw err;
    }
  };
  
  const getAttribution = (): Record<string, string> | null => {
    const params = new URLSearchParams(window.location.search);
    const attr: Record<string, string | null> = {
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
      fbclid: params.get('fbclid'),
      gclid: params.get('gclid'),
      ref: params.get('ref'),
    };
    const filtered: Record<string, string> = {};
    for (const key in attr) {
      if (attr[key] !== null) { filtered[key] = attr[key]!; }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  };

  const trackEvent = async (eventType: string, metadata: Record<string, any> = {}): Promise<void> => {
    if (!sessionId) {
      console.warn('[SpaceRuntime] Cannot track event without sessionId');
      return;
    }
    
    try {
      const response = await fetch(`/api/space/${spaceId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          visitorId,
          eventType,
          metadata,
          attribution: getAttribution(),
        }),
      });
      
      if (!response.ok) {
        console.warn('[SpaceRuntime] Failed to track event:', eventType);
        return;
      }
      
      // Get the eventId from the response and link to recording (like landing pages do)
      const data = await response.json();
      if (data.eventId && (window as any).__RECORDING_ID__) {
        try {
          await fetch(`/api/crm/session-recordings/${(window as any).__RECORDING_ID__}/link`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ funnelEventId: data.eventId }),
          });
          console.log('[SpaceRuntime] Recording linked to event:', data.eventId);
        } catch (linkErr) {
          console.warn('[SpaceRuntime] Failed to link recording to event:', linkErr);
        }
      }
    } catch (err) {
      console.warn('[SpaceRuntime] Track event error:', err);
    }
  };

  const getVerifiedSessionIdentity = useCallback(
    () => readVerifiedStoredSession(`space_session_${spaceId}`),
    [spaceId],
  );

  useEffect(() => {
    subscriptionRef.current = subscription;
  }, [subscription]);

  const readCachedSubscription = useCallback((): SubscriptionState | null => {
    try {
      const cachedSub = safeStorageGet(`space_subscription_${spaceId}`);
      if (!cachedSub) return null;
      return JSON.parse(cachedSub) as SubscriptionState;
    } catch {
      return null;
    }
  }, [spaceId]);

  const buildSafeNonEntitledSubscription = useCallback((
    email: string,
    fallback?: SubscriptionState | null,
  ): SubscriptionState => ({
    status: 'registered',
    planTier: fallback?.planTier ?? null,
    email,
    stripeCustomerId: null,
    subscriptionId: null,
    trialDaysRemaining: 0,
    trialDays: 0,
    trialExpired: true,
    hasPaymentMethod: false,
    contactId: fallback?.contactId ?? null,
    manualOverride: null,
  }), []);

  const getSafeFallbackSubscription = useCallback((
    email: string,
    fallback?: SubscriptionState | null,
  ): SubscriptionState | null => {
    if (!fallback) return null;

    if ([
      'registered',
      'not_registered',
      'canceled',
      'trial_expired',
      'past_due',
      'incomplete',
    ].includes(fallback.status)) {
      return { ...fallback, email };
    }

    const hasVerifiedEntitlement = !!fallback.subscriptionId || !!fallback.manualOverride;
    if (
      hasVerifiedEntitlement &&
      (fallback.status === 'trialing' || fallback.status === 'trial' || fallback.status === 'active')
    ) {
      return { ...fallback, email };
    }

    return buildSafeNonEntitledSubscription(email, fallback);
  }, [buildSafeNonEntitledSubscription]);

  const refreshSubscription = useCallback(async () => {
    const identity = getVerifiedSessionIdentity();
    if (!identity?.email) {
      console.log('[SpaceRuntime] No verified session identity, skipping subscription check');
      setSubscription(null);
      setSubscriptionReady(true);
      return;
    }
    const { email, sessionId: verifiedSessionId } = identity;

    const restoreSafeFallback = (source: string) => {
      const cachedFallback = getSafeFallbackSubscription(email, readCachedSubscription());
      const previousFallback = getSafeFallbackSubscription(email, subscriptionRef.current);
      const fallbackState = cachedFallback || previousFallback || buildSafeNonEntitledSubscription(email, subscriptionRef.current);
      console.warn(`[SpaceRuntime] Subscription status fetch failed, restoring safe fallback from ${source}:`, fallbackState.status);
      setSubscription(fallbackState);
      setSubscriptionReady(true);
    };

    // Only block the UI on the very first check. Once we've resolved a real
    // subscription state, subsequent refreshes (Stripe return, force-refresh
    // from inside an app) must not flip `subscriptionReady` back to `false` —
    // doing so causes SubscriptionReadyGate to flash the full-screen loader
    // every time the bundle decides to revalidate.
    const hasPriorResolved = subscriptionRef.current !== null
      && subscriptionRef.current.status !== 'loading';

    try {
      if (!hasPriorResolved) {
        setSubscriptionReady(false);
        setSubscription({
          status: 'loading' as const, planTier: null, email, stripeCustomerId: null,
          subscriptionId: null, trialDaysRemaining: 0, trialDays: 0, trialExpired: false,
          hasPaymentMethod: false, contactId: null, manualOverride: null,
        });
      }

      const response = await fetch(
        `/api/space/${spaceId}/subscription-status?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(verifiedSessionId)}`,
        {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        },
      );

      if (!response.ok) {
        console.warn('[SpaceRuntime] Subscription status fetch failed:', response.status);
        restoreSafeFallback(`http_${response.status}`);
        return;
      }

      const data = await response.json();
      console.log('[SpaceRuntime] Subscription status:', data.status);

      const newState: SubscriptionState = {
        status: data.status || 'not_registered',
        planTier: data.planTier || null,
        email,
        stripeCustomerId: data.hasPaymentMethod ? 'exists' : null,
        subscriptionId: data.subscriptionId || null,
        trialDaysRemaining: data.trialDaysRemaining || 0,
        trialDays: data.trialDays || 0,
        trialExpired: data.trialExpired || false,
        hasPaymentMethod: data.hasPaymentMethod || false,
        contactId: data.contactId || null,
        manualOverride: data.manualOverride || null,
      };

      setSubscription(newState);
      // Guarded: a QuotaExceeded/SecurityError here would otherwise fall into
      // the catch below and overwrite the fresh state with a stale fallback.
      safeStorageSet(`space_subscription_${spaceId}`, JSON.stringify(newState));
      setSubscriptionReady(true);
    } catch (err) {
      console.error('[SpaceRuntime] Subscription check error:', err);
      restoreSafeFallback('network_error');
    }
  }, [spaceId, getVerifiedSessionIdentity, buildSafeNonEntitledSubscription, getSafeFallbackSubscription, readCachedSubscription]);

  const updateSubscription = useCallback((updates: Partial<SubscriptionState>) => {
    setSubscription(prev => {
      const updated = prev
        ? { ...prev, ...updates }
        : {
            status: 'not_registered' as const, planTier: null, email: null,
            stripeCustomerId: null, subscriptionId: null, trialDaysRemaining: 0,
            trialDays: 0, trialExpired: false, hasPaymentMethod: false,
            contactId: null, manualOverride: null, ...updates,
          };
      // Guarded: this runs inside a React state updater — an unguarded storage
      // throw here would crash the render/dispatch cycle.
      safeStorageSet(`space_subscription_${spaceId}`, JSON.stringify(updated));
      return updated;
    });
  }, [spaceId]);

  const checkAppAccess = useCallback((requiredTier?: string): boolean => {
    if (mode === 'entrepreneur') return true;
    if (!subscription) return false;
    if (subscription.status === 'active') return true;
    if (subscription.manualOverride) return true;
    if ((subscription.status === 'trialing' || subscription.status === 'trial') && !subscription.trialExpired) return true;
    return false;
  }, [mode, subscription]);

  const userRole = (sessionMetadata.role as string) || null;

  const checkRoleAccess = useCallback((allowedRoles?: string[]): boolean => {
    if (mode === 'entrepreneur') return true;
    if (!allowedRoles || allowedRoles.length === 0) return true;
    if (!userRole) return false;
    return allowedRoles.includes(userRole);
  }, [mode, userRole]);

  const purchaseFiredRef = useRef(false);

  const firePurchaseEvent = (email: string | null, amount?: number, currency?: string, stripeSessionId?: string | null): boolean => {
    let fbqFired = false;
    if (typeof (window as any).fbq === 'function') {
      const eventParams: Record<string, any> = {
        content_name: 'Subscription Purchase',
        content_category: 'space',
        value: amount ?? 0,
        currency: (currency || 'usd').toUpperCase(),
      };
      const advancedMatching = email
        ? { em: email.toLowerCase().trim() }
        : undefined;
      (window as any).fbq('track', 'Purchase', eventParams, advancedMatching);
      console.log(`[SpaceRuntime] Meta Pixel Purchase event fired (value=${eventParams.value}, currency=${eventParams.currency})`);
      fbqFired = true;
    }

    // Task #1480: parallel Reddit Pixel Purchase. Keyed on the Stripe session id
    // for client↔server CAPI dedupe. Caller wraps this in purchaseFiredRef so a
    // refresh won't re-fire either pixel. Calls window.rdt directly — the
    // queue stub installed by the live PageVisit snippet (Task #1456) handles
    // late pixel.js loads.
    try {
      const rdt = (window as any).rdt;
      const pixelId = (window as any).__REDDIT_PIXEL_ID__;
      if (typeof rdt === 'function') {
        if (pixelId && email) {
          rdt('init', pixelId, { email: email.toLowerCase().trim() });
        }
        const conversionId = stripeSessionId || `purchase_${spaceId}_${Date.now()}`;
        rdt('track', 'Purchase', {
          value: amount ?? 0,
          currency: (currency || 'usd').toUpperCase(),
          conversionId,
        });
        console.log(`[SpaceRuntime] Reddit Pixel Purchase event fired (value=${amount ?? 0}, currency=${(currency || 'usd').toUpperCase()}, conversionId=${conversionId})`);
      }
    } catch (e) {
      console.warn('[SpaceRuntime] Reddit Pixel Purchase failed:', e);
    }

    return fbqFired;
  };

  const firePurchaseEventWithRetry = async (email: string | null, stripeSessionId?: string | null) => {
    if (!stripeSessionId) {
      console.log('[SpaceRuntime] No session_id in URL — skipping Purchase event (cannot confirm payment)');
      return;
    }

    let amount: number | undefined;
    let currency: string | undefined;

    try {
      const baseUrl = window.location.origin;
      const resp = await fetch(`${baseUrl}/api/payments/status/${stripeSessionId}`, {
        headers: { 'X-App-Id': getPaymentAppId(spaceId) },
      });
      if (!resp.ok) {
        console.warn(`[SpaceRuntime] Failed to verify payment status (HTTP ${resp.status}) — skipping Purchase event`);
        return;
      }

      const data = await resp.json();

      if (!data.countsAsPurchase) {
        console.log(`[SpaceRuntime] Skipping Purchase event — session not qualified (status: ${data.status}, paymentStatus: ${data.paymentStatus}, mode: ${data.mode})`);
        return;
      }

      amount = (data.purchaseValueCents ?? 0) / 100;
      currency = data.currency || 'usd';
      console.log(`[SpaceRuntime] Purchase qualified: ${amount} ${currency.toUpperCase()} (mode: ${data.mode}, paymentStatus: ${data.paymentStatus})`);

      await trackEvent('purchase', {
        value: amount,
        currency,
        stripeSessionId,
        mode: data.mode,
        paymentStatus: data.paymentStatus,
      });
    } catch (e) {
      console.warn('[SpaceRuntime] Error fetching payment status — skipping Purchase event', e);
      return;
    }

    if (!firePurchaseEvent(email, amount, currency, stripeSessionId)) {
      const maxRetries = 5;
      const delays = [100, 200, 400, 800, 1600];
      const retryWithBackoff = (attempt: number) => {
        if (attempt >= maxRetries) return;
        setTimeout(() => {
          if (!firePurchaseEvent(email, amount, currency, stripeSessionId)) {
            retryWithBackoff(attempt + 1);
          }
        }, delays[attempt]);
      };
      retryWithBackoff(0);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    const verifiedIdentity = getVerifiedSessionIdentity();
    if (!verifiedIdentity?.email) {
      setSubscription(null);
      setSubscriptionReady(true);
      return;
    }

    // Guarded: this effect runs once sessionId is truthy — i.e. right after a
    // successful registration. An unguarded storage read here crashed the page
    // for storage-blocked browsers at the worst possible moment.
    const cachedSub = safeStorageGet(`space_subscription_${spaceId}`);
    if (cachedSub) {
      try {
        setSubscription(JSON.parse(cachedSub));
      } catch {}
    }

    const params = new URLSearchParams(window.location.search);
    const isReturnFromStripe = params.has('subscription_success') || params.has('payment_success');
    const stripeSessionId = params.get('session_id');

    if (isReturnFromStripe) {
      console.log('[SpaceRuntime] Detected return from Stripe, refreshing subscription with retry...');

      if (!purchaseFiredRef.current) {
        purchaseFiredRef.current = true;
        firePurchaseEventWithRetry(verifiedIdentity.email, stripeSessionId);
      }

      const retryDelays = [2000, 5000, 10000];
      let attempt = 0;
      const tryRefresh = async () => {
        await refreshSubscription();
        let sub: { status?: string } = {};
        try {
          sub = JSON.parse(safeStorageGet(`space_subscription_${spaceId}`) || '{}');
        } catch {}
        if (sub.status && sub.status !== 'active' && sub.status !== 'loading' && attempt < retryDelays.length - 1) {
          attempt++;
          console.log(`[SpaceRuntime] Subscription not yet active (${sub.status}), retrying in ${retryDelays[attempt]}ms...`);
          setTimeout(tryRefresh, retryDelays[attempt]);
        }
      };
      setTimeout(tryRefresh, retryDelays[0]);

      const url = new URL(window.location.href);
      url.searchParams.delete('subscription_success');
      url.searchParams.delete('payment_success');
      url.searchParams.delete('plan');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.toString());
    } else {
      refreshSubscription();
    }
  }, [sessionId, spaceId, refreshSubscription, getVerifiedSessionIdentity]);

  const value: SpaceRuntimeContextValue = {
    mode,
    spaceId,
    sessionId,
    setSessionId,
    visitorId,
    isBootstrappingSession,
    config,
    isLoading,
    error,
    readFile,
    readTemplateFile,
    writeFile,
    listFiles,
    trackEvent,
    refetchConfig: fetchConfig,
    subscription,
    subscriptionReady,
    updateSubscription,
    refreshSubscription,
    checkAppAccess,
    sessionMetadata,
    userRole,
    checkRoleAccess,
  };

  return (
    <SpaceRuntimeContext.Provider value={value}>
      {isBootstrappingSession ? (
        <div
          data-testid="space-session-bootstrap"
          role="status"
          aria-live="polite"
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Verifying sign-in…
        </div>
      ) : children}
    </SpaceRuntimeContext.Provider>
  );
}

export function useSpaceRuntime() {
  const context = useContext(SpaceRuntimeContext);
  
  if (!context) {
    throw new Error('useSpaceRuntime must be used within SpaceRuntimeProvider');
  }
  
  return context;
}

export function useSubscription() {
  const { subscription, subscriptionReady, updateSubscription, refreshSubscription, checkAppAccess, mode } = useSpaceRuntime();
  
  const isPremium = mode === 'entrepreneur' || (subscription?.status === 'active') || !!subscription?.manualOverride;
  const isTrial = (subscription?.status === 'trialing' || subscription?.status === 'trial') && !subscription?.trialExpired;
  const isExpired = subscription?.status === 'trial_expired' || subscription?.status === 'canceled';
  const loading = !subscriptionReady || (!!subscription && subscription.status === 'loading');
  
  return {
    subscription,
    isPremium,
    isTrial,
    isExpired,
    loading,
    trialDaysRemaining: subscription?.trialDaysRemaining || 0,
    updateSubscription,
    refreshSubscription,
    checkAppAccess,
  };
}
