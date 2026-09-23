import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowRight,
  X,
  Plus,
  Sparkles,
  Compass,
  Eye,
  Layers,
  Rocket,
  MousePointerClick,
  Heart,
  Check,
} from 'lucide-react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';
import NeoFlashCanvas from '../apps/SceneLog/NeoFlashCanvas';
import ThemeSwitcher, {
  THEME_KEYS,
  THEMES,
  THEME_STORAGE_KEY,
  type ThemeKey,
} from './NeoFlashThemeSwitcher';
import { parseNeoFlash } from '../apps/SceneLog/neoflashEngine';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 102; // v102: server-bound OpenAI Ads measurement consent receipts

// server reads this to confirm this compiled copy carries the serverEventId dedup stamp; gates the CAPI send. Independent of EMAIL_GATE_VERSION.
export const META_CAPI_DEDUP_VERSION = 1;

// ---------------------------------------------------------------------------
// Safe web-storage access (Trello 182365-45NQXG5C / 182365-5SA2TXCD).
//
// iOS Safari private mode, storage-blocked enterprise browsers, and sandboxed
// iframes can throw on ANY localStorage touch (SecurityError on read/write,
// QuotaExceededError on write). Every storage access in this file must go
// through these helpers: a storage write failure AFTER the server has
// registered the visitor must NOT fail the flow — the gate continues with
// in-memory state instead of surfacing "Connection error" and looping.
//
// When localStorage is unusable, values land in a tab-scoped in-memory
// fallback shared across the bundle via `window.__audosSafeStorageMemory__`
// (EmailGate, SpaceRuntimeContext, and Desktop each ship a copy of these
// helpers but must observe each other’s writes — the session stored here
// must satisfy SpaceRuntimeContext’s stored-session authorization check).
// The session then lives for the lifetime of the tab, and the visitor simply
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

type ParsedResponseBody = { data: unknown; rawText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Parses a fetch Response body safely so a 5xx HTML page (proxy timeout,
// memory-crash restart, etc.) does not throw inside `response.json()` and
// get swallowed into the generic "Connection error" copy. Always returns
// an object instead of throwing — callers inspect `response.ok` themselves.
async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return { data: null, rawText: '' };
  }

  if (!rawText) {
    return { data: null, rawText: '' };
  }

  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

// Pick the most informative error message we can show to the user given
// what came back over the wire. Server-provided `error` always wins; for
// unparseable / non-JSON responses we expose the HTTP status so the bug
// is debuggable instead of being hidden behind "Connection error".
function describeResponseFailure(
  response: Response,
  body: unknown,
  rawText: string,
  fallback: string,
): string {
  if (isRecord(body)) {
    const errField = body.error;
    if (typeof errField === 'string' && errField.trim()) return errField;
    const msgField = body.message;
    if (typeof msgField === 'string' && msgField.trim()) return msgField;
  }

  const status = response.status;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is temporarily unavailable. Please try again in a moment.';
  }
  if (status >= 500) return `Server error (${status}). Please try again.`;
  if (status === 404) return 'This space could not be found. Please contact support.';
  if (status === 403) return 'This email is not authorized to access this space.';
  if (status === 400 && rawText) {
    // Sometimes the server returns a plain text 400; surface a trimmed copy
    const snippet = rawText.trim().slice(0, 140);
    if (snippet) return snippet;
  }

  return fallback;
}

// Snapshot of the JSON envelope returned by /api/space/:spaceId/register.
// All fields are optional because the server has historically added/removed
// keys; the client narrows individually before use.
interface SpaceRegisterResponseBody {
  success?: boolean;
  workspaceSessionId?: string | null;
  provisionalSessionToken?: string;
  // Task 4379 shared-client contract. The server decides whether the visitor
  // must prove ownership via OTP (`otpRequired: true` — retain the
  // provisional-token OTP flow) or was authorized as a legacy registration
  // (`legacyAuthorized: true` + `otpRequired: false` — adopt only the
  // server-returned canonical `workspaceSessionId`, no OTP). Authorization is
  // NEVER inferred client-side from isReturningUser / subscription / payment /
  // client verified flags; the client trusts only these explicit server flags.
  otpRequired?: boolean;
  legacyAuthorized?: boolean;
  identityMode?: 'strict_verified' | 'legacy_registration' | 'pending_verification' | string;
  contactId?: string | null;
  email?: string;
  isReturningUser?: boolean;
  sessionVerified?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  visitorId?: string | null;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  // Meta CAPI: server-generated Lead eventID. Reused as the browser pixel’s
  // eventID so Meta dedupes the browser + server sends of the same lead.
  serverEventId?: string | null;
}

interface OpenAIAdsMeasurementWindow extends Window {
  __audosConsent?: { hasMarketing: () => boolean };
  __OPENAI_ADS_MEASUREMENT_SURFACE_CONTEXT__?: string;
  __OPENAI_ADS_MEASUREMENT_RECEIPT__?: string | null;
  __OPENAI_ADS_MEASUREMENT_CONSENT_PROMISE__?: Promise<string | null>;
  __audosRequestOpenAIAdsMeasurementConsent?: (input: {
    granted: boolean;
    explicitMarketingMeasurementOptIn: boolean;
    source: 'email_gate' | 'server_policy';
  }) => Promise<string | null>;
}

const getOpenAIAdsMeasurementWindow = () =>
  window as OpenAIAdsMeasurementWindow;

function syncOpenAIAdsMeasurementConsent(
  granted: boolean,
  explicitMarketingMeasurementOptIn: boolean,
  source: 'email_gate' | 'server_policy',
): Promise<void> {
  const measurementWindow = getOpenAIAdsMeasurementWindow();
  if (typeof measurementWindow.__audosRequestOpenAIAdsMeasurementConsent !== 'function') {
    return Promise.resolve();
  }
  const pending = measurementWindow.__audosRequestOpenAIAdsMeasurementConsent({
    granted,
    explicitMarketingMeasurementOptIn,
    source,
  });
  measurementWindow.__OPENAI_ADS_MEASUREMENT_CONSENT_PROMISE__ = pending;
  return pending.then(() => undefined).catch(() => undefined);
}

async function awaitOpenAIAdsMeasurementConsent(): Promise<void> {
  const pending =
    getOpenAIAdsMeasurementWindow().__OPENAI_ADS_MEASUREMENT_CONSENT_PROMISE__;
  if (!pending) return;
  await Promise.race([
    pending.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  ]);
}

// Snapshot of the JSON envelope returned by /api/auth/otp/space/{send,verify}.
interface OtpResponseBody {
  success?: boolean;
  sessionVerified?: boolean;
  resendCooldown?: number;
  attemptsRemaining?: number;
  expiresIn?: number;
  canonicalSessionId?: string;
}

interface EmailGateProps {
  spaceId: string;
  branding?: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    heroVideoUrl?: string;
    colors?: Record<string, any>;
    palette?: Record<string, any>;
  };
  themeTokens?: DesktopThemeTokens;
}

// Task #5225 - tell the platform’s serve-time social-return completion shim
// that THIS screen finishes the Google return itself (cookie pickup below in
// restoreSessionFromPlatformCookie, failure copy in consumeSocialAuthError),
// so the shim stands down and no visitor gets a double session pickup or a
// duplicated error message. Set at module scope: the shim only reads it after
// the space bundle has evaluated, and a gate that is present but not mounted
// still owns the return. Frozen pre-#5225 bundles never set it, which is
// exactly how the shim recognises a screen that needs healing.
if (typeof window !== 'undefined') {
  (window as any).__AUDOS_SOCIAL_AUTH_RETURN__ = true;
}

/** KryZYngE — paid-campaign arrivals should see the sign-in modal, not just the marketing landing. */
export function hasPaidCampaignAttribution(
  search = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    return ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].some((key) => {
      const value = params.get(key);
      return typeof value === 'string' && value.trim().length > 0;
    });
  } catch {
    return false;
  }
}
type GateStep = 'loading' | 'email' | 'code' | 'complete';

function TypewriterText({ text, replayOnView = false }: { text: string; replayOnView?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visibleText, setVisibleText] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer: number | null = null;
    let hasPlayed = false;
    let wasVisible = false;
    const type = () => {
      if (timer !== null) window.clearInterval(timer);
      let index = 0;
      setVisibleText('');
      timer = window.setInterval(() => {
        index += 1;
        setVisibleText(text.slice(0, index));
        if (index >= text.length && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      }, 52);
      hasPlayed = true;
    };
    if (typeof IntersectionObserver === 'undefined') {
      type();
      return () => { if (timer !== null) window.clearInterval(timer); };
    }
    const observer = new IntersectionObserver(([entry]) => {
      const nowVisible = !!entry?.isIntersecting;
      if (nowVisible && (!hasPlayed || (replayOnView && !wasVisible))) type();
      wasVisible = nowVisible;
    }, { threshold: .55 });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [replayOnView, text]);

  return <span ref={hostRef} aria-label={text}><span aria-hidden="true">{visibleText}</span><span aria-hidden="true" className="nf-type-cursor">_</span></span>;
}

// Derive a usable color set from a single hex primary color
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 3 && clean.length !== 6) return null;
  const normalized =
    clean.length === 3
      ? clean.split('').map((char) => char + char).join('')
      : clean;
  return {
    r: parseInt(normalized.substring(0, 2), 16),
    g: parseInt(normalized.substring(2, 4), 16),
    b: parseInt(normalized.substring(4, 6), 16),
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  return match ? `#${match[1]}` : undefined;
}

function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.58 ? '#111827' : '#ffffff';
}

function sessionCheckUrl(
  spaceId: string,
  workspaceId: string,
  sessionUuid?: string,
): string {
  const sharedSpacePath = `/space/${encodeURIComponent(spaceId)}`;
  const isSharedSpaceRoute = window.location.pathname === sharedSpacePath;
  const params = new URLSearchParams();
  if (!isSharedSpaceRoute) {
    params.set('workspaceId', workspaceId);
    params.set('spaceId', spaceId);
  }
  if (sessionUuid) params.set('sessionUuid', sessionUuid);
  const query = params.toString();
  const base = isSharedSpaceRoute
    ? `${sharedSpacePath}/check-session`
    : '/api/auth/otp/space/check-session';
  return query ? `${base}?${query}` : base;
}

export default function EmailGate({
  spaceId,
  branding,
  themeTokens,
}: EmailGateProps) {
  const { setSessionId } = useSpaceRuntime();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [donationAmount, setDonationAmount] = useState('5');
  const [donationLoading, setDonationLoading] = useState(false);
  const [donationError, setDonationError] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<GateStep>('loading');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingBinding, setPendingBinding] = useState<{
    token: string;
    workspaceId: string;
  } | null>(null);
  const [pendingSessionMetadata, setPendingSessionMetadata] = useState<Record<string, unknown>>({});
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loginOpen, setLoginOpen] = useState(() => hasPaidCampaignAttribution());
  const [entered, setEntered] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [selectedDemo, setSelectedDemo] = useState(0);
  const [navPopup, setNavPopup] = useState<'features' | 'demos' | 'export' | null>(null);
  const [landingTheme, setLandingTheme] = useState<ThemeKey>(() => {
    const stored = safeStorageGet(THEME_STORAGE_KEY);
    return stored && THEME_KEYS.includes(stored as ThemeKey) ? stored as ThemeKey : 'cyberpunk';
  });
  const [themeTransitioning, setThemeTransitioning] = useState(false);
  const themeTransitionTimerRef = useRef<number | null>(null);
  const activeTheme = THEMES[landingTheme];
  const themeRunKey = THEME_KEYS.indexOf(landingTheme) + 101;
  const themeHeroScene = useMemo(
    () => parseNeoFlash(activeTheme.heroScene),
    [activeTheme.heroScene],
  );
  const logoScene = useMemo(
    () => parseNeoFlash(`stage 480 128 transparent\nsymbol brand NeoFlashLogo 8 4 scale=1 primary=${activeTheme.accentColor} secondary=${activeTheme.cssVars['--nf-accent-2']} theme=${landingTheme}`),
    [activeTheme, landingTheme],
  );
  const navLinksScene = useMemo(
    () => parseNeoFlash(`stage 520 88 transparent\nsymbol navFeatures NeonText 85 52 text=FEATURES size=xs color=${activeTheme.cssVars['--nf-text']} tracking=1 weight=900 glow=false\nsymbol navDemos NeonText 260 52 text=DEMOS size=xs color=${activeTheme.cssVars['--nf-text']} tracking=1 weight=900 glow=false\nsymbol navExport NeonText 425 52 text=EXPORT size=xs color=${activeTheme.accentColor} tracking=1 weight=900 glow=${landingTheme === 'cyberpunk' || landingTheme === 'space'}\nevery 5.4s flicker navFeatures min=.88 max=1\nevery 6.2s flicker navDemos min=.9 max=1\nevery 4.9s flicker navExport min=.82 max=1`),
    [activeTheme, landingTheme],
  );
  const finalCtaScene = useMemo(
    () => parseNeoFlash(`stage 460 100 transparent\nsymbol finalCta NeonButton 30 14 width=400 height=72 label=START_ANIMATING_FREE_→ color=${activeTheme.accentColor} textColor=${activeTheme.bgColor} variant=primary glow=${landingTheme !== 'minimal'}`),
    [activeTheme, landingTheme],
  );
  const popupFeaturesScene = useMemo(
    () => parseNeoFlash(`stage 300 90 transparent\nsymbol t1 NeonText 10 26 text=▶_DECLARATIVE_LANGUAGE size=xs color=${activeTheme.accentColor} tracking=2 weight=900 glow=${landingTheme !== 'minimal'}\nsymbol t2 NeonText 10 52 text=▶_SVG_BROWSER-NATIVE size=xs color=${activeTheme.cssVars['--nf-accent-2'] || activeTheme.accentColor} tracking=2 weight=800 glow=false\nsymbol t3 NeonText 10 76 text=▶_REAL-TIME_TIMELINE size=xs color=${activeTheme.cssVars['--nf-muted']} tracking=2 weight=600 glow=false\nevery 4.1s flicker t1 min=.82 max=1\nevery 5.3s flicker t2 min=.86 max=1`),
    [activeTheme, landingTheme]
  );
  const popupDemosScene = useMemo(
    () => parseNeoFlash(activeTheme.demoScenes[0]?.scene ?? ''),
    [activeTheme]
  );
  const popupExportScene = useMemo(
    () => parseNeoFlash(`stage 300 90 transparent\nsymbol e1 NeonText 10 26 text=//EDIT_EVERY_LINE size=xs color=${activeTheme.accentColor} tracking=2 weight=900 glow=${landingTheme !== 'minimal'}\nsymbol e2 NeonText 10 52 text=//SAVE_THE_SCENE size=xs color=${activeTheme.cssVars['--nf-accent-2'] || activeTheme.accentColor} tracking=2 weight=800 glow=false\nsymbol e3 NeonText 10 76 text=//SHIP_TO_THE_WEB size=xs color=${activeTheme.cssVars['--nf-muted']} tracking=2 weight=600 glow=false\nevery 3.7s flicker e1 min=.8 max=1`),
    [activeTheme, landingTheme]
  );
  const featureScene = useMemo(
    () => parseNeoFlash(`stage 1280 520 transparent\nsymbol featureOne NeonCard 70 80 width=350 height=330 borderColor=${activeTheme.accentColor} bgColor=${activeTheme.cssVars['--nf-card-bg']} title=DESCRIBE subtitle=01_//_PROMPT body=Start_with_natural_language_instead_of_a_blank_canvas. icon=spark glow=${landingTheme !== 'minimal'} mobileStageWidth=720 mobileStageHeight=900 mobileX=100 mobileY=40 mobileWidth=520 mobileHeight=250\nsymbol featureTwo NeonCard 465 80 width=350 height=330 borderColor=${activeTheme.cssVars['--nf-accent-2']} bgColor=${activeTheme.cssVars['--nf-card-bg']} title=ANIMATE subtitle=02_//_LIVE_SVG body=Watch_the_browser-native_renderer_bring_every_layer_to_life. icon=code glow=${landingTheme !== 'minimal'} mobileX=100 mobileY=320 mobileWidth=520 mobileHeight=250\nsymbol featureThree NeonCard 860 80 width=350 height=330 borderColor=${activeTheme.accentColor} bgColor=${activeTheme.cssVars['--nf-card-bg']} title=REMIX subtitle=03_//_EXPORT body=Edit_every_line,_save_the_scene,_and_ship_it_to_the_web. icon=export glow=${landingTheme !== 'minimal'} mobileX=100 mobileY=600 mobileWidth=520 mobileHeight=250\nevery 5.2s flicker featureOne min=.88 max=1\nevery 6.1s flicker featureTwo min=.9 max=1\nevery 5.7s flicker featureThree min=.9 max=1`),
    [activeTheme, landingTheme],
  );
  const themedDemoScene = useMemo(
    () => parseNeoFlash(activeTheme.demoScenes[selectedDemo]?.scene ?? activeTheme.demoScenes[0].scene),
    [activeTheme, selectedDemo],
  );
  // Meta CAPI dedup: the server’s Lead eventID from /register is stashed here so
  // the post-OTP-verify pixel fire (register response already out of scope)
  // reuses it and Meta collapses the browser + server sends.
  const serverEventIdRef = useRef<string | null>(null);

  // Get workspaceId from window context
  const workspaceId = (window as any).__WORKSPACE_ID__ || null;
  const gdprEnabled = !!(window as any).__GDPR_ENABLED__;
  // Template previews (genesis-space*) aren’t tied to a workspace, so the
  // normal email/OTP registration can’t complete — always offer guest entry
  // there. Cloned workspaces (workspace-N) keep the flag-gated behavior.
  const isTemplatePreview = spaceId === 'genesis-space' || spaceId.startsWith('genesis-space-');
  const guestModeEnabled = !!(window as any).__GUEST_MODE_ENABLED__ || isTemplatePreview;
  const rawSocialProviders = (window as any).__SOCIAL_PROVIDERS__;
  const socialProviders: string[] = Array.isArray(rawSocialProviders) ? rawSocialProviders : [];

  // A social sign-in failure can only come back as a bounded code on the return
  // URL, so read it once and strip it so a reload does not replay a stale error.
  const consumeSocialAuthError = (): string => {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('social_auth_error');
      if (!code) return '';
      url.searchParams.delete('social_auth_error');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
      const copy: Record<string, string> = {
        google_access_denied: 'Google sign-in was cancelled.',
        google_code_missing: 'Google did not finish the sign-in. Please try again.',
        google_not_configured: 'Google sign-in is not available right now.',
        google_session_unavailable: 'We could not start your session. Please try again.',
        google_account_conflict: 'This email is already connected to another Google account. Sign in with the account you used before.',
      };
      return copy[code] || 'Google sign-in did not complete. Please try again.';
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    const socialError = consumeSocialAuthError();
    if (socialError) setError(socialError);
    storeAttribution();
    checkExistingSession();
  }, [spaceId]);

  useEffect(() => {
    if (!gdprEnabled) {
      void syncOpenAIAdsMeasurementConsent(true, false, 'server_policy');
    }
  }, [gdprEnabled, spaceId]);

  // Pre-fill email from localStorage when loaded inside the onboarding walkthrough
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('walkthrough') === 'true') {
      const storedEmail = safeStorageGet('user_email');
      if (storedEmail) setEmail(storedEmail);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Landing hero entrance animation (client-only; defaults visible if JS is slow)
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (step !== 'email') return;
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>('.nf-landing .nf-reveal'));
    if (typeof IntersectionObserver === 'undefined') {
      revealNodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .18, rootMargin: '0px 0px -7% 0px' });
    revealNodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [step, landingTheme]);

  // Keep the selected landing theme on the document root while the gate is
  // mounted. Cleanup ensures the playground never inherits landing-only vars.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(activeTheme.cssVars).forEach(([name, value]) => root.style.setProperty(name, value));
    root.dataset.neoflashTheme = landingTheme;
    safeStorageSet(THEME_STORAGE_KEY, landingTheme);
    return () => {
      if (root.dataset.neoflashTheme === landingTheme) delete root.dataset.neoflashTheme;
      Object.keys(activeTheme.cssVars).forEach((name) => root.style.removeProperty(name));
    };
  }, [activeTheme, landingTheme]);

  useEffect(() => () => {
    if (themeTransitionTimerRef.current !== null) window.clearTimeout(themeTransitionTimerRef.current);
  }, []);

  // Floating header: transparent over the hero, solid after the visitor scrolls.
  // The landing page scrolls inside `.eg-root` (not the window), so the listener
  // attaches to that container. Re-runs on step change since eg-root only exists
  // on the main landing screen.
  useEffect(() => {
    const root = document.querySelector('.eg-root');
    if (!root) return;
    const onScroll = () => setScrolled(root.scrollTop > 24);
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [step]);

  // Task #4642 — cold-start restore. Safari/iOS evicts page-written storage
  // for sites the visitor has not opened in about a week, so a signed-in
  // customer returns with NOTHING stored while the platform’s HttpOnly
  // session cookie is still valid — and the gate asked for a code again.
  // When nothing is stored, ask check-session ONCE with no session id: the
  // server answers from that cookie alone, through the same strict resolver,
  // and returns the canonical session to adopt. Any other answer (no cookie,
  // forged, expired, wrong workspace, signed out) falls through to the normal
  // sign-in screen, so a genuinely signed-out visitor pays for one request.
  const restoreSessionFromPlatformCookie = async (): Promise<boolean> => {
    if (!workspaceId) return false;
    try {
      const res = await fetch(
        sessionCheckUrl(spaceId, workspaceId),
        { credentials: 'include' }
      );
      if (!res.ok) return false;
      const data = await res.json();
      const canonicalSessionId = data?.canonicalSessionId;
      if (
        typeof canonicalSessionId !== 'string' ||
        !canonicalSessionId.startsWith('wses_')
      ) {
        return false;
      }
      // Same acceptance rule as a remembered session: strict verification, or
      // an explicitly server-authorized legacy registration. Never inferred.
      const legacyAuthorized =
        data.authorized === true && data.identityMode === 'legacy_registration';
      if (data.verified !== true && !legacyAuthorized) return false;
      const restoredEmail =
        typeof data.email === 'string' ? data.email.toLowerCase().trim() : '';
      const restoredSession = {
        id: canonicalSessionId,
        workspaceSessionId: canonicalSessionId,
        email: restoredEmail,
        timestamp: Date.now(),
        verified: data.verified === true,
        isReturningUser: true,
        metadata: {},
        ...(legacyAuthorized
          ? { authorized: true, identityMode: 'legacy_registration' }
          : {}),
      };
      try {
        safeStorageSet(`space_session_${spaceId}`, JSON.stringify(restoredSession));
      } catch (e) {}
      if (restoredEmail) setEmail(restoredEmail);
      try {
        (window as any).__audosAcceptedSessionId = canonicalSessionId;
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: {
            workspaceSessionId: canonicalSessionId,
            email: restoredEmail,
            verified: data.verified === true,
            ...(legacyAuthorized
              ? { authorized: true, identityMode: 'legacy_registration' }
              : {}),
          }
        }));
      } catch (e) {}
      setSessionId(canonicalSessionId);
      setStep('complete');
      return true;
    } catch (e) {
      return false;
    }
  };

  const showEmailStep = () => {
    setStep('email');
    if (hasPaidCampaignAttribution()) setLoginOpen(true);
  };

  const checkExistingSession = async () => {
    // `?as=visitor` preview: never adopt a stored session — skip straight to the
    // logged-out email form instead of jumping to the empty 'complete' state.
    const forceVisitor = typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true;
    const sessionKey = `space_session_${spaceId}`;
    // Guarded: an unguarded read here left the gate stuck on the blank
    // 'loading' step in storage-throw browsers.
    const existingSession = forceVisitor ? null : safeStorageGet(sessionKey);

    if (existingSession) {
      try {
        const session = JSON.parse(existingSession);
        const effectiveSessionId = session.workspaceSessionId || session.id;
        const storedEmail =
          typeof session.email === 'string'
            ? session.email.trim().toLowerCase()
            : '';

        if (effectiveSessionId) {
          if (
            session.isGuest === true &&
            guestModeEnabled &&
            effectiveSessionId.startsWith('guest_')
          ) {
            setSessionId(effectiveSessionId);
            setStep('complete');
            return;
          }
          if (workspaceId) {
            try {
              const checkRes = await fetch(sessionCheckUrl(spaceId, workspaceId, effectiveSessionId), {
                credentials: 'include'
              });
              const checkData = await checkRes.json();

              // Task 4379: a remembered legacy-registration session is
              // preserved only when the server returns authorized:true AND
              // identityMode:'legacy_registration'. Any other stored session
              // keeps the strict verified:true behavior. Authorization is never
              // inferred client-side.
              const serverEmailMatches =
                typeof checkData.email === 'string' &&
                checkData.email.trim().toLowerCase() === storedEmail;
              const serverAuthorizedLegacy =
                checkData.authorized === true &&
                checkData.identityMode === 'legacy_registration';
              const accepted =
                session.identityMode === 'legacy_registration'
                  ? serverAuthorizedLegacy
                  : session.verified === true && checkData.verified === true;

              if (accepted && serverEmailMatches) {
                setSessionId(effectiveSessionId);
                setStep('complete');
                return;
              }
              safeStorageRemove(sessionKey);
              if (storedEmail) setEmail(storedEmail);
              showEmailStep();
              return;
            } catch (e) {
              console.error('[EmailGate] Session check failed; keeping workspace sign-in closed');
              setError('Sign-in verification is temporarily unavailable. Please try again.');
              showEmailStep();
              return;
            }
          }

          setError('Sign-in verification is temporarily unavailable. Please try again.');
          showEmailStep();
          return;
        }
      } catch (e) {
        console.error('Failed to parse session:', e);
      }
    }

    // Task #4642 — nothing usable stored: one cold-start restore attempt from
    // the platform session cookie before falling back to the sign-in screen.
    if (!forceVisitor && (await restoreSessionFromPlatformCookie())) return;

    showEmailStep();
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const normalizedEmail = email.toLowerCase().trim();

      if (workspaceId) {
        const attribution = getAttribution();
        const visitorId = getVisitorId();
        const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        await awaitOpenAIAdsMeasurementConsent();
        const measurementWindow = getOpenAIAdsMeasurementWindow();

        const registerRes = await fetch(`/api/space/${spaceId}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: normalizedEmail,
            sessionId,
            visitorId,
            attribution,
            metadata: {},
            workspaceId,
            sourceUrl: window.location.href,
            marketingConsent,
            measurementConsent:
              typeof measurementWindow.__OPENAI_ADS_MEASUREMENT_RECEIPT__ === 'string',
            surfaceContextToken:
              measurementWindow.__OPENAI_ADS_MEASUREMENT_SURFACE_CONTEXT__,
            measurementConsentReceipt:
              measurementWindow.__OPENAI_ADS_MEASUREMENT_RECEIPT__ || undefined,
          }),
        });

        const { data: registerResult, rawText: registerRawText } =
          await parseResponseBody(registerRes);

        if (!registerRes.ok) {
          console.error('[EmailGate] register failed', {
            status: registerRes.status,
            body: registerResult ?? registerRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              registerRes,
              registerResult,
              registerRawText,
              'Failed to create session. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        if (!isRecord(registerResult)) {
          console.error('[EmailGate] register returned an unparseable body', {
            status: registerRes.status,
            rawText: registerRawText.slice(0, 200),
          });
          setError('The server returned an unexpected response. Please try again.');
          setLoading(false);
          return;
        }

        const registerBody = registerResult as SpaceRegisterResponseBody;

        // Meta CAPI dedup: stash the server’s Lead eventID (present only on a
        // new lead) so the eventual pixel fire reuses it.
        if (registerBody.serverEventId) {
          serverEventIdRef.current = registerBody.serverEventId;
        }

        // OTP-disabled returning visitors may already own a canonical verified
        // server session. Preserve that strict identity instead of downgrading
        // it to a legacy marker that /check-session would later reject.
        if (
          registerBody.success === true &&
          registerBody.sessionVerified === true &&
          registerBody.legacyAuthorized === false &&
          registerBody.otpRequired === false &&
          registerBody.identityMode === 'strict_verified'
        ) {
          const strictSessionId = registerBody.workspaceSessionId;
          if (typeof strictSessionId !== 'string' || !strictSessionId.startsWith('wses_')) {
            setError('The server did not return a valid session. Please try again.');
            setLoading(false);
            return;
          }
          await completeVerifiedSession(strictSessionId);
          await fireLeadEventWithRetry(normalizedEmail, strictSessionId);
          return;
        }

        // Task 4379: legacy-registration short-circuit. When (and only when)
        // the server explicitly authorizes this visitor as a legacy
        // registration and does NOT require OTP, adopt the canonical
        // server-returned `workspaceSessionId` directly and enter without a
        // code. Authorization is trusted from the server flags alone — never
        // inferred from isReturningUser / subscription / payment / a local
        // verified flag — and the session id is never minted client-side.
        if (
          registerBody.success === true &&
          registerBody.legacyAuthorized === true &&
          registerBody.otpRequired === false &&
          registerBody.identityMode === 'legacy_registration'
        ) {
          const legacySessionId = registerBody.workspaceSessionId;
          if (
            typeof legacySessionId !== 'string' ||
            !legacySessionId.startsWith('wses_')
          ) {
            setError('The server did not return a valid session. Please try again.');
            setLoading(false);
            return;
          }
          await completeLegacyAuthorizedSession(
            legacySessionId,
            registerBody.metadata || {},
          );
          if (typeof (window as any).fbq === 'function') {
            if (typeof (window as any).__audosInitMetaPixels === 'function') {
              (window as any).__audosInitMetaPixels({ em: normalizedEmail });
            } else if ((window as any).__META_PIXEL_ID__) {
              (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail });
            }
          }
          await fireLeadEventWithRetry(normalizedEmail, legacySessionId);
          return;
        }

        const provisionalSessionToken = registerBody.provisionalSessionToken;
        const resolvedWorkspaceId = registerBody.workspaceId;
        if (
          registerBody.success !== true ||
          typeof provisionalSessionToken !== 'string' ||
          !provisionalSessionToken ||
          typeof resolvedWorkspaceId !== 'string' ||
          !resolvedWorkspaceId
        ) {
          setError('The server did not create a verification session. Please try again.');
          setLoading(false);
          return;
        }
        setPendingBinding({
          token: provisionalSessionToken,
          workspaceId: resolvedWorkspaceId,
        });
        setPendingSessionMetadata(registerBody.metadata || {});

        const response = await fetch('/api/auth/otp/space/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: normalizedEmail,
            workspaceId: resolvedWorkspaceId,
            spaceId,
            sessionUuid: provisionalSessionToken,
          }),
        });

        const { data: otpResult, rawText: otpRawText } = await parseResponseBody(response);

        if (!response.ok) {
          console.error('[EmailGate] otp send failed', {
            status: response.status,
            body: otpResult ?? otpRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              response,
              otpResult,
              otpRawText,
              'Failed to send code. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        const otpBody: OtpResponseBody = isRecord(otpResult) ? otpResult : {};
        setResendCooldown(otpBody.resendCooldown ?? 60);
        setStep('code');
      } else {
        await completeTemplatePreview();
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleEmailSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 4) {
      setError('Please enter the 4-digit code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (!pendingBinding) {
        setError('Session expired. Please start over.');
        setStep('email');
        setLoading(false);
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: normalizedEmail,
          code,
          workspaceId: pendingBinding.workspaceId,
          spaceId,
          sessionUuid: pendingBinding.token,
        }),
      });

      const { data: verifyResult, rawText: verifyRawText } = await parseResponseBody(response);
      const verifyBody: OtpResponseBody = isRecord(verifyResult) ? verifyResult : {};

      const canonicalSessionId = verifyBody.canonicalSessionId;
      if (
        !response.ok ||
        verifyBody.success !== true ||
        verifyBody.sessionVerified !== true ||
        typeof canonicalSessionId !== 'string' ||
        !canonicalSessionId.startsWith('wses_')
      ) {
        console.error('[EmailGate] otp verify failed', {
          status: response.status,
          body: verifyResult ?? verifyRawText.slice(0, 200),
        });
        if (typeof verifyBody.attemptsRemaining === 'number') {
          setError(`Invalid code. ${verifyBody.attemptsRemaining} attempts remaining.`);
        } else {
          setError(
            describeResponseFailure(
              response,
              verifyResult,
              verifyRawText,
              'Invalid code. Please try again.',
            ),
          );
        }
        setLoading(false);
        return;
      }

      await completeVerifiedSession(canonicalSessionId);
      if (typeof (window as any).fbq === 'function') {
        if (typeof (window as any).__audosInitMetaPixels === 'function') {
          (window as any).__audosInitMetaPixels({ em: normalizedEmail });
        } else if ((window as any).__META_PIXEL_ID__) {
          (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail });
        }
      }
      await fireLeadEventWithRetry(normalizedEmail, canonicalSessionId);
    } catch (err) {
      console.error('[EmailGate] Network error in handleCodeSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || !pendingBinding) return;

    setLoading(true);
    setError('');

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: normalizedEmail,
          workspaceId: pendingBinding.workspaceId,
          spaceId,
          sessionUuid: pendingBinding.token,
        }),
      });

      const { data: resendResult, rawText: resendRawText } = await parseResponseBody(response);

      if (response.ok) {
        const resendBody: OtpResponseBody = isRecord(resendResult) ? resendResult : {};
        setResendCooldown(resendBody.resendCooldown ?? 60);
        setCode('');
      } else {
        console.error('[EmailGate] otp resend failed', {
          status: response.status,
          body: resendResult ?? resendRawText.slice(0, 200),
        });
        setError(
          describeResponseFailure(
            response,
            resendResult,
            resendRawText,
            'Failed to resend code. Please try again.',
          ),
        );
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleResendCode:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const completeVerifiedSession = async (canonicalSessionId: string) => {
    if (!canonicalSessionId.startsWith('wses_')) {
      setError('Session verification failed. Please start over.');
      setStep('email');
      setLoading(false);
      return;
    }
    const sessionKey = `space_session_${spaceId}`;
    const normalizedEmail = email.toLowerCase().trim();
    let verifiedMetadata: Record<string, unknown> = pendingSessionMetadata;
    try {
      const existingSession = safeStorageGet(sessionKey);
      if (existingSession) {
        const parsed = JSON.parse(existingSession);
        if (parsed.metadata) verifiedMetadata = parsed.metadata;
      }
    } catch {}
    const session = {
      id: canonicalSessionId,
      workspaceSessionId: canonicalSessionId,
      email: normalizedEmail,
      timestamp: Date.now(),
      verified: true,
      isReturningUser: true,
      metadata: verifiedMetadata,
    };
    // Guarded: the server has ALREADY registered and verified this visitor.
    // A storage write throw here used to bubble into handleCodeSubmit’s catch
    // and turn a successful registration into a "Connection error" loop.
    safeStorageSet(sessionKey, JSON.stringify(session));

    try {
      (window as any).__audosAcceptedSessionId = canonicalSessionId;
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: canonicalSessionId,
          email: normalizedEmail,
          verified: true,
        }
      }));
    } catch (e) {}

    setSessionId(canonicalSessionId);
    completeGateEntry();
    setLoading(false);
  };

  // Task 4379: adopt a server-authorized legacy-registration session (no OTP).
  // The session id MUST be the canonical `wses_` id the server returned; we
  // never mint it locally. The stored marker records `identityMode:
  // 'legacy_registration'` explicitly so remembered-session revalidation can
  // preserve the legacy identity only when /check-session confirms it.
  const completeLegacyAuthorizedSession = async (
    legacySessionId: string,
    metadata: Record<string, unknown>,
  ) => {
    if (!legacySessionId.startsWith('wses_')) {
      setError('The server did not return a valid session. Please try again.');
      setStep('email');
      setLoading(false);
      return;
    }
    const sessionKey = `space_session_${spaceId}`;
    const normalizedEmail = email.toLowerCase().trim();
    const session = {
      id: legacySessionId,
      workspaceSessionId: legacySessionId,
      email: normalizedEmail,
      timestamp: Date.now(),
      verified: false,
      authorized: true,
      isReturningUser: true,
      identityMode: 'legacy_registration' as const,
      metadata,
    };
    // Guarded: the server has ALREADY authorized this visitor; a storage-throw
    // browser must still enter the space via the in-memory fallback.
    safeStorageSet(sessionKey, JSON.stringify(session));

    try {
      (window as any).__audosAcceptedSessionId = legacySessionId;
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: legacySessionId,
          email: normalizedEmail,
          verified: false,
          authorized: true,
          identityMode: 'legacy_registration',
        }
      }));
    } catch (e) {}

    setSessionId(legacySessionId);
    completeGateEntry();
    setLoading(false);
  };

  const completeTemplatePreview = async () => {
    if (!isTemplatePreview) {
      setError('Sign-in verification is temporarily unavailable. Please try again.');
      return;
    }
    const previewId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const previewSession = {
      id: previewId,
      workspaceSessionId: previewId,
      email: null,
      isGuest: true,
      timestamp: Date.now(),
      verified: false,
      metadata: {},
    };
    safeStorageSet(`space_session_${spaceId}`, JSON.stringify(previewSession));
    try {
      (window as any).__audosAcceptedSessionId = previewId;
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: { workspaceSessionId: previewId, isGuest: true },
      }));
    } catch (e) {}
    setSessionId(previewId);
    completeGateEntry();
  };

  const handleGuestMode = async () => {
    setError('');
    setLoading(true);

    try {
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const sessionKey = `space_session_${spaceId}`;
      const guestSession = {
        id: guestId,
        workspaceSessionId: guestId,
        email: null,
        isGuest: true,
        timestamp: Date.now(),
        verified: false,
        metadata: {},
      };
      safeStorageSet(sessionKey, JSON.stringify(guestSession));

      try {
        (window as any).__audosAcceptedSessionId = guestId;
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: guestId, isGuest: true },
        }));
      } catch (e) {}

      setSessionId(guestId);
      completeGateEntry();
    } catch (err) {
      setError('Could not continue as guest. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // `?as=visitor` preview forces the signed-out view even after a real
  // sign-in: the gate would render nothing and the visitor would land on the
  // blank-screen lock instead of the space. The session write is real (only
  // reads are shadowed under the forced-visitor preview), so drop the
  // as=visitor param and reload — the fresh session is adopted and the
  // signed-in space opens.
  const completeGateEntry = () => {
    try {
      if (typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true) {
        const url = new URL(window.location.href);
        url.searchParams.delete('as');
        window.location.replace(url.toString());
        return;
      }
    } catch (e) {}
    setStep('complete');
  };

  const handleSocialLogin = (provider: string) => {
    // Strip the forced-visitor preview flag from the OAuth return URL so the
    // visitor comes back to the signed-in space, not the forced signed-out view.
    let socialReturnTo = window.location.href;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('as');
      socialReturnTo = url.toString();
    } catch (e) {}
    const returnUrl = encodeURIComponent(socialReturnTo);
    const url = workspaceId
      ? `/api/auth/social/${provider}?workspaceId=${workspaceId}&spaceId=${spaceId}&returnUrl=${returnUrl}`
      : `/api/auth/social/${provider}?spaceId=${spaceId}&returnUrl=${returnUrl}`;
    window.location.href = url;
  };

  // Guarded: this runs before lead-event firing right after a successful
  // registration — a storage throw here must not break the sign-in flow.
  // The in-memory fallback keeps the generated id stable for this tab.
  function getVisitorId(): string {
    const key = 'audos_visitor_id';
    let id = safeStorageGet(key);
    if (!id) {
      id = `v_${Math.random().toString(36).substring(2)}_${Date.now()}`;
      safeStorageSet(key, id);
    }
    return id;
  }

  function getAttrCookie(): Record<string, string> | null {
    try {
      const raw = safeStorageGet('audos_attribution');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setAttrCookie(jsonStr: string) {
    const ATTR_COOKIE_NAME = 'audos_attr';
    const MULTI_LEVEL_TLDS = ['co.uk','co.za','co.in','co.jp','co.kr','co.nz','com.au','com.br','com.cn','com.mx','com.sg','com.hk','com.tw','com.ar','com.co','com.eg','com.my','com.ng','com.pe','com.ph','com.pk','com.tr','com.ua','com.vn','org.uk','org.au','net.au','net.uk','ac.uk','gov.uk','gov.au','edu.au','ne.jp','or.jp'];
    const hostname = window.location.hostname;
    const platformDomains = [
      'replit.dev', 'replit.app', 'repl.co',
      'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
      'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
      'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
      'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
      'fly.dev', 'deno.dev', 'glitch.me'
    ];
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    let isPlatform = false;
    for (let i = 0; i < platformDomains.length; i++) {
      if (hostname.endsWith('.' + platformDomains[i]) || hostname === platformDomains[i]) {
        isPlatform = true;
        break;
      }
    }
    let domainPart = '';
    if (!isLocalhost && !isIP && !isPlatform) {
      const parts = hostname.split('.');
      const lastTwo = parts.slice(-2).join('.');
      if (MULTI_LEVEL_TLDS.indexOf(lastTwo) !== -1 && parts.length >= 3) {
        domainPart = '; domain=.' + parts.slice(-3).join('.');
      } else if (parts.length >= 2) {
        domainPart = '; domain=.' + parts.slice(-2).join('.');
      }
    }
    const isSecure = window.location.protocol === 'https:';
    const secureFlag = isSecure ? '; Secure' : '';
    document.cookie = ATTR_COOKIE_NAME + '=' + encodeURIComponent(jsonStr) + '; max-age=86400; path=/' + domainPart + '; SameSite=Lax' + secureFlag;
  }

  function storeAttribution() {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = params.has('utm_source') || params.has('utm_medium') || params.has('utm_campaign') || params.has('fbclid') || params.has('gclid') || params.has('oppref') || params.has('ref');
    if (!hasUtm) return;

    const attr: Record<string, string> = { capturedAt: Date.now().toString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'oppref', 'ref'].forEach(p => {
      const v = params.get(p);
      // Trello #4187: store canonical snake_case keys (utm_source), matching
      // the audos_attr cookie payload. The old alias mangling produced
      // 'utmsource'-style keys no server-side reader recognized.
      if (v) attr[p === 'ref' ? 'referrer' : p] = v;
    });
    if (document.referrer) attr.httpReferrer = document.referrer;

    safeStorageSet('audos_attribution', JSON.stringify(attr));

    const cookieAttr: Record<string, string> = { capturedAt: new Date().toISOString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'oppref', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) cookieAttr[p] = v;
    });
    if (document.referrer) cookieAttr.httpReferrer = document.referrer;
    try {
      setAttrCookie(JSON.stringify(cookieAttr));
      console.log('[EmailGate] Attribution stored in cookie:', cookieAttr);
    } catch {}
  }

  async function fireLeadEventWithRetry(
    emailAddr: string,
    verifiedSessionId: string,
    attempt = 0,
  ) {
    const normalizedEmail = emailAddr.toLowerCase().trim();
    // Task #1480: stable conversion id used for both client-side rdt('track','Lead', …)
    // and server-side Reddit CAPI so they dedupe.
    const conversionId = `lead_${spaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Meta CAPI dedup: reuse the server’s Lead eventID (from /register) so the
    // browser + server sends collapse to one conversion.
    const serverEventId = serverEventIdRef.current;
    const tryFireFbq = (): boolean => {
      const trackMeta = (window as any).__audosTrackMetaEvent;
      if (typeof trackMeta === 'function') {
        const eventId = trackMeta('Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
        }, serverEventId || undefined);
        if (eventId) {
          console.log('[EmailGate] Meta Pixel Lead event fired:', eventId);
          return true;
        }
      }
      if (typeof (window as any).fbq === 'function') {
        const pixelId = (window as any).__META_PIXEL_ID__;
        if (!pixelId) return false;
        const eventId = serverEventId || `meta_lead_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        // Workspace-scoped conversions: the serve-time-injected key lets
        // this workspace’s Meta custom conversion rule match the Lead.
        // (The __audosTrackMetaEvent wrapper path above merges it server-side.)
        const wsKey = (window as any).__AUDOS_WS_KEY__;
        (window as any).fbq('trackSingle', String(pixelId), 'Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
          ...(wsKey ? { audos_ws_key: String(wsKey) } : {}),
        }, {
          eventID: eventId
        });
        console.log('[EmailGate] Meta Pixel Lead event fired:', eventId);
        return true;
      }
      return false;
    };

    if (!tryFireFbq()) {
      console.log('[EmailGate] fbq not ready, will retry with exponential backoff...');
      const maxRetries = 5;
      const delays = [100, 200, 400, 800, 1600];

      const retryWithBackoff = (retryAttempt: number) => {
        if (retryAttempt >= maxRetries) {
          console.warn('[EmailGate] Failed to fire Lead event - fbq never loaded after 5 retries');
          return;
        }
        setTimeout(() => {
          if (tryFireFbq()) {
            console.log(`[EmailGate] Lead event fired after ${retryAttempt + 1} retries`);
          } else {
            retryWithBackoff(retryAttempt + 1);
          }
        }, delays[retryAttempt]);
      };

      retryWithBackoff(0);
    }

    // Task #1480: Reddit Pixel Lead (parallel to Meta). We call window.rdt
    // directly — the queue stub installed by the injected PageVisit snippet
    // (Task #1456, already live) handles late pixel.js loads, so we don’t
    // need the exponential-backoff retry the Meta path uses. Re-running
    // rdt('init', …, { email, externalId }) propagates advanced matching for
    // the subsequent Lead event (Reddit "Step 3: Set up match keys").
    try {
      const rdt = (window as any).rdt;
      const pixelId = (window as any).__REDDIT_PIXEL_ID__;
      if (typeof rdt === 'function') {
        if (pixelId) {
          rdt('init', pixelId, { email: normalizedEmail, externalId: getVisitorId() });
        }
        rdt('track', 'Lead', { conversionId });
        console.log('[EmailGate] Reddit Pixel Lead event fired (conversionId=' + conversionId + ')');
      }
    } catch (e) {
      console.warn('[EmailGate] Reddit Pixel Lead failed:', e);
    }

    if (!workspaceId) return;
    try {
      await fetch(`/api/space/${spaceId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'lead',
          sessionId: verifiedSessionId,
          visitorId: getVisitorId(),
          // Task #1480: include conversionId so server-side Reddit CAPI dedupes
          // with the client-side rdt('track','Lead',…) fired above.
          conversionId,
          metadata: { email: emailAddr, conversionId, ...getAttribution() },
          workspaceId,
        }),
      });
    } catch {
      if (attempt < 2) {
        setTimeout(
          () => fireLeadEventWithRetry(emailAddr, verifiedSessionId, attempt + 1),
          2000,
        );
      }
    }
  }

  const getAttribution = () => {
    const params = new URLSearchParams(window.location.search);

    const urlAttribution: Record<string, string | null> = {};
    if (params.get('utm_source')) urlAttribution.utmSource = params.get('utm_source');
    if (params.get('utm_medium')) urlAttribution.utmMedium = params.get('utm_medium');
    if (params.get('utm_campaign')) urlAttribution.utmCampaign = params.get('utm_campaign');
    if (params.get('utm_content')) urlAttribution.utmContent = params.get('utm_content');
    if (params.get('utm_term')) urlAttribution.utmTerm = params.get('utm_term');
    if (params.get('fbclid')) urlAttribution.fbclid = params.get('fbclid');
    if (params.get('gclid')) urlAttribution.gclid = params.get('gclid');
    if (params.get('oppref')) urlAttribution.oppref = params.get('oppref');
    if (params.get('ref')) urlAttribution.referrer = params.get('ref');
    if (document.referrer) urlAttribution.httpReferrer = document.referrer;

    const storedAttr = getAttrCookie();

    const merged: Record<string, string | null> = {};
    if (storedAttr) {
      for (const [key, value] of Object.entries(storedAttr)) {
        if (value && key !== 'capturedAt') merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(urlAttribution)) {
      if (value) merged[key] = value;
    }

    return Object.keys(merged).length > 0 ? merged : null;
  };

  const runtimeConfig = (window as any).__SPACE_CONFIG__;
  const runtimeDesktop = runtimeConfig?.desktop || {};
  const runtimeThemeTokens = runtimeDesktop?.themeTokens || {};
  const runtimeBranding = runtimeDesktop?.branding || {};
  // Founder-selected typography flows through themeTokens.typography (kickoff →
  // compiled __SPACE_CONFIG__). Derive the body/heading font stacks here so the
  // landing renders the chosen fonts instead of a hard-coded system-ui.
  const typography =
    themeTokens?.typography || runtimeThemeTokens?.typography || {};
  const bodyFontStack = typography.bodyFont
    ? `"${typography.bodyFont}", system-ui, -apple-system, sans-serif`
    : 'system-ui, -apple-system, sans-serif';
  const headingFontStack = typography.headingFont
    ? `"${typography.headingFont}", system-ui, -apple-system, sans-serif`
    : bodyFontStack;
  // Kickoff stores the manually selected color in palette.primary. Shell accent
  // is derived from palette.highlight and is only a fallback for older spaces.
  const selectedAccentColor = normalizeHexColor(
    themeTokens?.shell?.accentColor ||
      runtimeThemeTokens?.shell?.accentColor ||
      runtimeDesktop?.theme?.accentColor,
  );
  const palette =
    themeTokens?.palette ||
    runtimeThemeTokens?.palette ||
    branding?.palette ||
    runtimeBranding?.palette ||
    branding?.colors ||
    runtimeBranding?.colors ||
    {};
  const palettePrimary = normalizeHexColor(palette?.primary);
  const primaryColor = palettePrimary || selectedAccentColor || '#1e293b';
  const highlightColor = normalizeHexColor(palette?.highlight || palette?.secondary) || primaryColor;
  const contrastColor = palette?.contrast || '#ffffff';
  const brandName = branding?.name || 'NeoFlash';
  const tagline = branding?.tagline || 'Describe it. Animate it. Instantly.';
  const logoUrl = branding?.logoUrl;
  const bgLight = palette?.surfaces?.page || colorWithAlpha(primaryColor, 0.04);
  const bgMedium = palette?.surfaces?.accentSoft || colorWithAlpha(primaryColor, 0.08);
  const borderColor = palette?.surfaces?.border || colorWithAlpha(primaryColor, 0.15);
  const panelColor = themeTokens?.shell?.panelBackground || palette?.surfaces?.panel || '#ffffff';
  const panelStrongColor =
    themeTokens?.shell?.panelStrongBackground || palette?.surfaces?.panelStrong || '#ffffff';
  const pageBackground = themeTokens?.shell?.pageBackground || palette?.surfaces?.page || '#ffffff';
  const sectionBackground = palette?.surfaces?.muted || '#f9fafb';
  const gateGradient =
    themeTokens?.shell?.gateBackground ||
    `linear-gradient(180deg, ${
      palette?.surfaces?.gradientFrom || bgLight
    } 0%, ${
      palette?.surfaces?.gradientVia || '#ffffff'
    } 55%, ${
      palette?.surfaces?.gradientTo || '#ffffff'
    } 100%)`;
  const textPrimary = palette?.text?.brand || primaryColor;
  const textMuted = palette?.text?.secondary || colorWithAlpha(primaryColor, 0.55);
  const textSubtle = palette?.text?.muted || colorWithAlpha(primaryColor, 0.35);
  const footerBackground = palette?.primaryScale?.['900'] || palette?.text?.primary || '#003847';
  const footerText = palette?.text?.muted || 'rgba(255,255,255,0.72)';
  const selectedAccentOverridesPalette = !palettePrimary && !!selectedAccentColor;
  const onPrimary = selectedAccentOverridesPalette
    ? readableTextColor(primaryColor)
    : palette?.text?.onPrimary || readableTextColor(primaryColor);
  const onHighlight = selectedAccentOverridesPalette
    ? readableTextColor(highlightColor)
    : palette?.text?.onHighlight || onPrimary;
  // Vibrant hero gradient built from the workspace palette (never hardcoded
  // brand hex) so every generated space gets its own energetic look.
  const heroGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 55%, ${contrastColor} 115%)`;
  const brandGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 100%)`;
  // Hero copy + CTAs sit on the gradient/video, so they stay white over a
  // dark scrim. The scrim deepens for light primaries so text stays legible
  // regardless of the workspace palette (contrast may resolve to white).
  const primaryRgb = hexToRgb(primaryColor);
  const primaryIsLight = primaryRgb
    ? (0.2126 * primaryRgb.r + 0.7152 * primaryRgb.g + 0.0722 * primaryRgb.b) / 255 > 0.62
    : false;
  const heroScrim = `linear-gradient(105deg, rgba(0,0,0,${primaryIsLight ? 0.6 : 0.42}) 0%, rgba(0,0,0,${primaryIsLight ? 0.42 : 0.18}) 48%, rgba(0,0,0,0) 88%)`;
  const heroVideoUrl =
    branding?.heroVideoUrl ||
    runtimeBranding.heroVideoUrl ||
    (window as any).__WORKSPACE_HERO_VIDEO_URL__ ||
    '';
  const heroHasVideo = typeof heroVideoUrl === 'string' && heroVideoUrl.trim().length > 0;
  const loginPanelId = 'email-gate-login-panel';

  const createDonationSession = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (donationLoading) return;

    const normalizedAmount = donationAmount.trim().replace(',', '.');
    const euros = Number(normalizedAmount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount) || !Number.isFinite(euros) || euros < 1) {
      setDonationError('Enter a donation amount of at least €1.');
      return;
    }

    const amount = Math.round(euros * 100);
    setDonationError('');
    setDonationLoading(true);

    try {
      const appId =
        (window as any).__APP_ID__ ||
        (window as any).__SPACE_ID__ ||
        spaceId;
      const workspaceRef = workspaceId || appId;
      if (!workspaceRef) throw new Error('Workspace identity is unavailable.');

      const response = await fetch(
        `/api/hooks/execute/${encodeURIComponent(String(workspaceRef))}/create-donation-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amount, appId }),
        },
      );
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(result) || typeof result.url !== 'string' || !result.url) {
        const message = isRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'Donation checkout could not be created.';
        throw new Error(message);
      }

      try {
        if (window.top && window.top !== window) {
          window.top.location.href = result.url;
          return;
        }
      } catch {
        // Cross-origin frame: navigate the current page instead.
      }
      window.location.href = result.url;
    } catch (caughtError) {
      console.error('[EmailGate] Failed to create donation checkout:', caughtError);
      setDonationError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Donation checkout could not be created.',
      );
    } finally {
      setDonationLoading(false);
    }
  };

  const openLogin = () => {
    setLoginOpen(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-email"]');
      input?.focus();
    }, 0);
  };

  const switchLandingTheme = (nextTheme: ThemeKey) => {
    if (nextTheme === landingTheme || themeTransitioning) return;
    setThemeTransitioning(true);
    if (themeTransitionTimerRef.current !== null) window.clearTimeout(themeTransitionTimerRef.current);
    themeTransitionTimerRef.current = window.setTimeout(() => {
      setLandingTheme(nextTheme);
      setSelectedDemo(0);
      window.requestAnimationFrame(() => setThemeTransitioning(false));
      themeTransitionTimerRef.current = null;
    }, 150);
  };

  const valueProps = [
    {
      title: 'From prompt to motion in seconds',
      desc: 'Type any scene in plain English — a neon bar, a bouncing ball, a passing car — and watch it animate instantly.',
    },
    {
      title: 'Easy when you want it. Code when you need it.',
      desc: 'Create with natural language in Easy mode, then switch to Advanced mode to inspect, remix, and own the NeoFlash code.',
    },
    {
      title: 'Spark keeps ideas moving',
      desc: 'Your embedded creative guide helps describe, refine, save, and reload scenes without breaking your flow.',
    },
  ];
  const howItWorks = [
    { step: '1', title: 'Describe your scene', desc: 'Start with any motion idea in plain English. No blank canvas, no special syntax required — just describe what you want to see move.' },
    { step: '2', title: 'Watch it animate', desc: 'NeoFlash turns your description into a browser-native, all-vector SVG scene in seconds.' },
    { step: '3', title: 'Refine it and keep it', desc: 'Remix the NeoFlash code, ask Spark for help, and save the scene so it is ready when you return.' },
  ];
  const testimonials = [
    { quote: 'Turn layouts, interactions, and visual concepts into motion without opening a heavyweight animation suite.', name: 'For web designers' },
    { quote: 'Build visual explanations, playful experiments, and expressive scenes with code you can inspect and own.', name: 'For educators, creative coders & motion enthusiasts' },
  ];
  const faqs = [
    { q: 'What is NeoFlash?', a: 'NeoFlash is a visual playground and declarative animation language for the web. Describe a scene in plain English or write NeoFlash code, then see it run instantly in your browser.' },
    { q: 'Who is NeoFlash for?', a: 'It is for web designers, educators, creative coders, and motion enthusiasts who want to move from an idea to a working animation without fighting heavy tools.' },
    { q: 'Do I need plugins or animation software?', a: 'No. NeoFlash runs entirely in the browser and renders vector SVG scenes — no plugins, downloads, or heavyweight setup.' },
    { q: 'What can Spark do?', a: 'Spark is the creative guide inside the playground. It helps you describe and refine scenes, understand NeoFlash syntax, and save or reload your work.' },
  ];

  // Presentational icons paired with the content arrays above by index.
  // Kept separate so the copy arrays stay plain for per-workspace rewrites.
  const valuePropIcons = [Eye, Layers, Rocket];
  const howItWorksIcons = [Compass, MousePointerClick, Rocket];

  // A monochrome onboarding mark (path marker ".mono.") can be recolored for
  // contrast; any other logo (legacy colored, knockout, dimensional) is shown
  // as-is on a neutral chip so it keeps working without clashing.
  const logoIsMono =
    typeof logoUrl === 'string' && /\.mono\.[a-z0-9]+(?:[?#].*)?$/i.test(logoUrl);

  // Centralized logo "block/chip": the fill derives from the current theme
  // tokens and the mark auto-picks white/black for contrast, so swapping the
  // brand palette recolors the block without ever regenerating the logo.
  const BrandMark = ({
    size = 40,
    blockColor,
    radiusScale = 0.26,
  }: { size?: number; blockColor?: string; radiusScale?: number }) => {
    const fill = blockColor || primaryColor;
    const markIsLight = readableTextColor(fill) === '#ffffff';
    const inner = Math.round(size * 0.6);
    const blockStyle = {
      width: size,
      height: size,
      borderRadius: Math.round(size * radiusScale),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    } as const;
    if (logoUrl && !logoIsMono) {
      return (
        <div
          style={{ ...blockStyle, backgroundColor: '#ffffff', border: `1px solid ${borderColor}` }}
        >
          <img
            src={logoUrl}
            alt={brandName}
            style={{ width: inner, height: inner, objectFit: 'contain' }}
          />
        </div>
      );
    }
    return (
      <div style={{ ...blockStyle, backgroundColor: fill }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName}
            style={{
              width: inner,
              height: inner,
              objectFit: 'contain',
              filter: markIsLight ? 'brightness(0) invert(1)' : 'brightness(0)',
            }}
          />
        ) : (
          <span
            style={{
              color: markIsLight ? '#ffffff' : '#111827',
              fontWeight: 700,
              fontSize: Math.round(size * 0.42),
              fontFamily: headingFontStack,
            }}
          >
            {brandName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  // Render as a helper, not a nested React component. A component declared
  // inside EmailGate gets a new type on every email state update, which makes
  // React replace the focused input and resets its caret to the end.
  const renderLoginPanel = (compact = false) => (
    <div
      id={loginPanelId}
      data-audos-caret-stable="1"
      className={compact ? '' : 'rounded-3xl p-6 sm:p-8'}
      style={compact ? undefined : {
        backgroundColor: panelColor,
        boxShadow: `0 24px 48px ${colorWithAlpha(primaryColor, 0.14)}, 0 2px 6px ${colorWithAlpha(primaryColor, 0.06)}`,
        border: `1px solid ${borderColor}`,
      }}
    >
      {!compact && (
        <div className="mb-5 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: brandGradient, color: onPrimary }}
          >
            <Sparkles size={22} strokeWidth={2.4} />
          </div>
          <p className="text-base font-extrabold" style={{ color: textPrimary }}>
            Open the NeoFlash playground
          </p>
          <p className="mt-1 text-sm" style={{ color: textMuted }}>
            Use your email to start turning ideas into motion.
          </p>
        </div>
      )}

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 text-base rounded-2xl focus:outline-none transition-all"
            style={{
              backgroundColor: sectionBackground,
              border: `2px solid ${error ? '#DC2626' : borderColor}`,
              color: textPrimary,
            }}
            disabled={loading}
            required
            autoFocus={loginOpen}
            data-testid="input-email"
          />
          {error && (
            <p className="mt-2 text-xs text-[var(--space-semantic-danger)]" data-testid="text-error">
              {error}
            </p>
          )}
        </div>

        {gdprEnabled && (
          <div
            className="space-y-2 rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: bgLight,
              color: textMuted,
            }}
          >
            <p>
              By entering your email, you agree to our{' '}
              <a href="/privacy" className="font-medium underline" style={{ color: textPrimary }}>
                Privacy Policy
              </a>.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => {
                  setMarketingConsent(e.target.checked);
                  syncOpenAIAdsMeasurementConsent(
                    e.target.checked,
                    e.target.checked,
                    'email_gate',
                  );
                }}
                className="mt-0.5 h-3.5 w-3.5 rounded"
                style={{ borderColor }}
              />
              <span>I want to receive marketing emails and updates (optional)</span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
          style={{
            backgroundColor: loading || !email
              ? colorWithAlpha(primaryColor, 0.35)
              : primaryColor,
            color: loading || !email ? 'rgba(255,255,255,0.7)' : onPrimary,
            cursor: loading || !email ? 'not-allowed' : 'pointer',
            boxShadow: loading || !email ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
          }}
          data-testid="button-continue"
        >
          {loading ? 'Just a moment...' : 'Open the playground'}
          {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
        </button>
      </form>

      {!compact && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-5 text-xs font-medium" style={{ color: textSubtle }}>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />Browser-native</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />No plugins</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />Vector SVG</span>
        </div>
      )}

      {socialProviders.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
            <span className="text-xs font-medium" style={{ color: textSubtle }}>or continue with</span>
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
          </div>
          <div className={`grid gap-2 ${socialProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {socialProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSocialLogin(provider)}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: panelColor,
                  border: `2px solid ${borderColor}`,
                  color: textPrimary,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="capitalize">{provider}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {guestModeEnabled && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleGuestMode}
            disabled={loading}
            className="text-sm font-semibold transition-colors hover:opacity-70"
            style={{ color: textMuted, cursor: loading ? 'not-allowed' : 'pointer' }}
            data-testid="button-guest-mode"
          >
            Continue as guest
          </button>
        </div>
      )}
    </div>
  );

  if (step === 'loading' || step === 'complete') {
    return null;
  }

  // OTP Code verification screen
  if (step === 'code') {
    return (
      <div
        className="min-h-screen flex flex-col overflow-y-auto"
        style={{ fontFamily: bodyFontStack, background: gateGradient }}
      >
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="text-center mb-10">
              <div className="flex justify-center mb-4">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}`, boxShadow: `0 10px 24px ${colorWithAlpha(primaryColor, 0.16)}` }}
                >
                  <BrandMark size={40} />
                </div>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>
                Check your inbox
              </h1>
              <p className="mt-2 text-sm" style={{ color: textMuted }}>
                We sent a 4-digit code to<br />
                <span className="font-medium" style={{ color: textPrimary }}>{email}</span>
              </p>
              <p className="mt-3 text-xs" style={{ color: textSubtle }}>
                can’t find it? Check your spam or junk folder.
              </p>
            </div>

            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setCode(val);
                    setError('');
                  }}
                  placeholder="0000"
                  className="w-full px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono rounded-xl focus:outline-none transition-all"
                  style={{
                    backgroundColor: panelColor,
                    border: `2px solid ${error ? '#DC2626' : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  autoFocus
                  data-testid="input-code"
                />
                {error && (
                  <p className="mt-2 text-xs text-[var(--space-semantic-danger)]" data-testid="text-error">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full py-3.5 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
                style={{
                  backgroundColor: loading || code.length !== 4 ? colorWithAlpha(primaryColor, 0.3) : primaryColor,
                  color: onPrimary,
                  cursor: loading || code.length !== 4 ? 'not-allowed' : 'pointer',
                  boxShadow: loading || code.length !== 4 ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
                }}
                data-testid="button-verify"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
                {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
              </button>
            </form>

            <div className="text-center mt-6 space-x-4">
              <button
                onClick={handleResendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-sm transition-colors"
                style={{ color: resendCooldown > 0 ? textSubtle : textPrimary }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
              <span style={{ color: textSubtle }}>|</span>
              <button
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="text-sm transition-colors"
                style={{ color: textMuted }}
              >
                Change email
              </button>
            </div>
          </div>
        </div>

        <div className="pb-8 text-center">
          <p className="text-xs" style={{ color: textSubtle }}>
            Your data is private and secure
          </p>
        </div>
      </div>
    );
  }

  // Main email entry screen - landing page first, native login panel on CTA.
  return (
    <>
      {/*
        WYSIWYG kickoff: the founder-chosen landing look replaces ONLY the shell
        region between the START/END markers below. Everything outside it — the
        auth hooks/handlers above, and the login modal + <LoginPanel> after END —
        is fixed platform infrastructure and is never LLM-regenerated, so
        sign-in / OTP / registration is guaranteed intact after a variant ships.
        A generated shell may use in-scope brand vars (primaryColor, brandName,
        heroVideoUrl, heroHasVideo, openLogin, BrandMark, colorWithAlpha, the
        lucide icons, …) but must not fetch, register, or duplicate auth.
        See server/services/kickoff-email-gate-variants.service.ts.
      */}
      {/* AUDOS:LANDING_SHELL:START */}
      <div
        className={`eg-root nf-landing h-screen overflow-y-auto ${themeTransitioning ? 'is-switching' : ''}`}
        data-neoflash-theme={landingTheme}
        data-card-style={activeTheme.cardStyle}
        style={{
          ...activeTheme.cssVars,
          height: '100dvh',
          WebkitOverflowScrolling: 'touch',
          fontFamily: 'var(--nf-font)',
          background: 'var(--nf-bg)',
          color: 'var(--nf-text)',
        }}
      >
        <style>{`
          @keyframes nf-cyber-flicker { 0%, 18%, 22%, 63%, 67%, 100% { opacity: 1; } 20%, 65% { opacity: .72; } }
          @keyframes nf-space-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          @keyframes nf-type-cursor { 0%, 48% { opacity: 1; } 49%, 100% { opacity: 0; } }
          @keyframes nf-subtitle-flicker { 0%, 91%, 96%, 100% { opacity: 1; } 93% { opacity: .62; } 98% { opacity: .82; } }
          @keyframes nf-manifesto-flicker {
            0%, 7%, 10%, 32%, 35%, 77%, 80%, 100% { opacity: 1; filter: brightness(1); text-shadow: 0 0 7px var(--nf-accent), 0 0 22px color-mix(in srgb, var(--nf-accent) 72%, transparent), 0 0 44px color-mix(in srgb, var(--nf-accent-2) 42%, transparent); }
            8%, 33%, 78% { opacity: .52; filter: brightness(1.75); text-shadow: 0 0 4px var(--nf-accent), 0 0 13px var(--nf-accent-2); }
            9%, 34%, 79% { opacity: .88; filter: brightness(1.25); }
            50% { opacity: 1; filter: brightness(1.12); text-shadow: 0 0 10px var(--nf-accent), 0 0 34px color-mix(in srgb, var(--nf-accent) 88%, transparent), 0 0 68px color-mix(in srgb, var(--nf-accent-2) 55%, transparent); }
          }
          @keyframes nf-cta-pulse { 0%, 100% { box-shadow: 0 0 12px color-mix(in srgb, var(--nf-accent) 45%, transparent), 0 0 28px color-mix(in srgb, var(--nf-accent) 24%, transparent); } 50% { box-shadow: 0 0 22px color-mix(in srgb, var(--nf-accent) 80%, transparent), 0 0 52px color-mix(in srgb, var(--nf-accent) 40%, transparent); } }
          @keyframes nf-footer-heartbeat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.3); } }
          .nf-landing { scrollbar-color: var(--nf-accent) var(--nf-bg); transition: background .3s ease, color .3s ease; }
          .nf-reveal { opacity: 0; transform: translateY(24px); transition: opacity .75s ease, transform .75s ease; }
          .nf-reveal.is-visible { opacity: 1; transform: none; }
          .nf-type-cursor { display: inline-block; width: .6em; color: var(--nf-accent); animation: nf-type-cursor .9s steps(1, end) infinite; }
          .nf-landing *, .nf-landing *::before, .nf-landing *::after { box-sizing: border-box; }
          .nf-landing h1, .nf-landing h2, .nf-landing h3 { font-family: var(--nf-heading-font); }
          .nf-theme-stage { min-height: 100%; opacity: 1; transform: translateY(0) scale(1); transition: opacity .3s ease, transform .3s ease; transform-origin: 50% 8%; }
          .nf-landing.is-switching .nf-theme-stage { opacity: 0; transform: translateY(10px) scale(.988); }
          .nf-nav { position: absolute; inset: 0 0 auto; z-index: 30; display: flex; height: 72px; align-items: center; gap: 22px; padding: 0 clamp(18px, 4vw, 64px); padding-right: clamp(390px, 34vw, 470px); border-bottom: 1px solid var(--nf-border); background: color-mix(in srgb, var(--nf-bg) 70%, transparent); backdrop-filter: blur(14px); }
          .nf-nav-logo { width: 180px; height: 50px; flex: 0 0 auto; }
          .nf-nav-links { width: min(360px, 34vw); height: 62px; }
          .nf-nav-meta { color: var(--nf-muted); font-size: 10px; font-weight: 800; letter-spacing: .16em; animation: nf-subtitle-flicker 6.2s steps(1, end) infinite; }
          .nf-nav-action { margin-left: auto; border: 1px solid var(--nf-accent); border-radius: var(--nf-radius); background: transparent; color: var(--nf-accent); padding: 9px 13px; font: 900 10px/1 var(--nf-font); letter-spacing: .08em; animation: nf-cta-pulse 2.3s ease-in-out infinite; }
          .nf-hero { position: relative; display: flex; min-height: 100svh; overflow: hidden; background: var(--nf-bg); }
          .nf-hero-canvas { position: absolute; inset: 0; z-index: 0; }
          .nf-hero-shade { position: absolute; inset: 0; z-index: 1; background: var(--nf-overlay); pointer-events: none; }
          .nf-hero::after { content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none; opacity: 0; }
          .nf-hero-layout { position: relative; z-index: 10; display: grid; width: min(1180px, 100%); margin: auto; padding: 118px 32px 72px; grid-template-columns: minmax(0, 1fr) minmax(280px, .72fr); align-items: center; gap: 44px; pointer-events: none; }
          .nf-hero-copy { max-width: 760px; }
          .nf-hero-brand { width: min(420px, 76vw); height: 112px; margin-bottom: 16px; }
          .nf-eyebrow { color: var(--nf-accent); font-size: 11px; font-weight: 1000; letter-spacing: .28em; animation: nf-subtitle-flicker 5.6s steps(1, end) infinite; }
          .nf-manifesto { margin: 16px 0 0; color: var(--nf-accent); font-size: clamp(52px, 8.4vw, 108px); font-weight: 1000; line-height: .8; letter-spacing: -.065em; text-transform: uppercase; animation: nf-manifesto-flicker 3.2s steps(1, end) infinite; }
          .nf-manifesto span { display: block; }
          .nf-manifesto .nf-manifesto-punch { color: var(--nf-accent-2); }
          .nf-hero-title { min-height: 2.05em; margin: 24px 0 0; color: var(--nf-text); font-size: clamp(29px, 4.2vw, 52px); font-weight: 1000; line-height: .95; letter-spacing: -.045em; }
          .nf-hero-title span { color: var(--nf-accent); }
          .nf-hero-copy p { max-width: 650px; margin: 20px 0 0; color: var(--nf-muted); font-size: clamp(15px, 1.8vw, 19px); line-height: 1.75; }
          .nf-primary-action { display: inline-flex; align-items: center; gap: 10px; margin-top: 30px; border: 2px solid var(--nf-accent); border-radius: var(--nf-radius); background: var(--nf-accent); color: var(--nf-bg); padding: 15px 20px; font: 1000 12px/1 var(--nf-font); letter-spacing: .09em; box-shadow: var(--nf-shadow); transition: transform .2s ease, filter .2s ease, box-shadow .2s ease; animation: nf-cta-pulse 2.3s ease-in-out infinite; pointer-events: auto; }
          .nf-primary-action:hover { transform: translateY(-3px) scale(1.025); filter: brightness(1.14); box-shadow: 0 0 30px color-mix(in srgb, var(--nf-accent) 90%, transparent), 0 0 70px color-mix(in srgb, var(--nf-accent) 45%, transparent); }
          .nf-neon-cta { width: min(460px, 100%); height: 100px; margin: 24px auto 0; cursor: pointer; animation: nf-cta-pulse 2.3s ease-in-out infinite; transition: transform .2s ease, filter .2s ease; }
          .nf-neon-cta:hover { transform: translateY(-3px) scale(1.025); filter: brightness(1.18); }
          .nf-hero-aside { align-self: end; border: 1px solid var(--nf-border); border-radius: var(--nf-radius); background: var(--nf-card-bg); padding: 18px; color: var(--nf-muted); box-shadow: var(--nf-shadow); backdrop-filter: blur(18px); }
          .nf-hero-aside strong { display: block; color: var(--nf-accent-2); font-size: 11px; letter-spacing: .18em; }
          .nf-hero-aside span { display: block; margin-top: 9px; font-size: 11px; line-height: 1.65; }
          .nf-section { border-top: 1px solid var(--nf-border); background: var(--nf-section-bg); padding: clamp(68px, 9vw, 120px) 24px; }
          .nf-section-inner { width: min(1120px, 100%); margin: 0 auto; }
          .nf-section-kicker { color: var(--nf-accent); font-size: 11px; font-weight: 1000; letter-spacing: .16em; animation: nf-subtitle-flicker 6.8s steps(1, end) infinite; }
          .nf-section-title { max-width: 800px; margin: 14px 0 0; color: var(--nf-text); font-size: clamp(34px, 5vw, 64px); font-weight: 1000; line-height: .95; letter-spacing: -.045em; }
          .nf-feature-canvas { width: 100%; height: auto; aspect-ratio: 1280 / 520; margin-top: 34px; overflow: hidden; }
          .nf-feature-grid { display: grid; margin-top: 44px; grid-template-columns: repeat(3, 1fr); gap: 18px; }
          .nf-feature-card { min-height: 260px; border: 1px solid var(--nf-border); border-radius: var(--nf-radius); background: var(--nf-card-bg); padding: 28px; box-shadow: var(--nf-shadow); transition: transform .25s ease, border-color .25s ease; backdrop-filter: blur(18px); }
          .nf-feature-card:hover { transform: translateY(-6px); border-color: var(--nf-accent); }
          .nf-feature-number { color: var(--nf-accent); font-size: 11px; font-weight: 1000; letter-spacing: .2em; }
          .nf-feature-card h3 { margin: 54px 0 0; color: var(--nf-text); font-size: 22px; font-weight: 1000; line-height: 1.05; }
          .nf-feature-card p { margin: 15px 0 0; color: var(--nf-muted); font-size: 13px; line-height: 1.75; }
          .nf-demo-shell { display: grid; overflow: hidden; margin-top: 40px; border: 1px solid var(--nf-border); border-radius: var(--nf-radius); background: var(--nf-panel); box-shadow: var(--nf-shadow); grid-template-columns: 1.18fr .82fr; }
          .nf-demo-canvas { position: relative; min-height: 470px; overflow: hidden; border-right: 1px solid var(--nf-border); background: var(--nf-bg); }
          .nf-landing[data-neoflash-theme="minimal"] .nf-demo-canvas { background: #f0f0f0; }
          .nf-demo-copy { display: flex; flex-direction: column; justify-content: center; padding: clamp(28px, 5vw, 58px); }
          .nf-demo-copy .nf-section-kicker { font-size: 12px; letter-spacing: .12em; }
          .nf-demo-copy h2 { margin: 14px 0 0; color: var(--nf-text); font-size: clamp(28px, 4vw, 48px); font-weight: 1000; line-height: .98; }
          .nf-demo-copy p { margin: 20px 0 0; color: var(--nf-muted); font-size: 13px; line-height: 1.8; }
          .nf-demo-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
          .nf-demo-tab { border: 1px solid var(--nf-border); border-radius: var(--nf-radius); background: var(--nf-bg); color: var(--nf-muted); padding: 9px 11px; font: 900 9px/1 var(--nf-font); letter-spacing: .08em; }
          .nf-demo-tab[aria-pressed="true"] { border-color: var(--nf-accent); background: var(--nf-accent); color: var(--nf-bg); box-shadow: var(--nf-shadow); }
          .nf-demo-stamp { position: absolute; right: 14px; bottom: 14px; border: 1px solid var(--nf-border); background: var(--nf-switcher-bg); color: var(--nf-accent); padding: 6px 8px; font-size: 9px; letter-spacing: .14em; backdrop-filter: blur(12px); }
          .nf-final-cta { text-align: center; }
          .nf-final-cta .nf-section-title { margin-inline: auto; }
          .nf-footer { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-height: 96px; gap: 20px; border-top: 1px solid var(--nf-border); background: var(--nf-bg); padding: 24px clamp(24px, 6vw, 84px); color: var(--nf-muted); font-size: 10px; letter-spacing: .12em; }
          .nf-footer > .nf-nav-logo { justify-self: start; }
          .nf-footer > .nf-nav-links { justify-self: center; }
          .nf-footer-right { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; justify-self: end; gap: 12px; text-align: right; }
          .nf-donate-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--nf-accent); border-radius: var(--nf-radius); background: transparent; color: var(--nf-accent); padding: 9px 13px; font: 900 10px/1 var(--nf-font); letter-spacing: .08em; text-decoration: none; animation: nf-cta-pulse 2.3s ease-in-out infinite; transition: transform .2s ease, filter .2s ease; }
          .nf-donate-btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.14); }
          .nf-donate-btn:disabled { cursor: wait; opacity: .72; }
          .nf-footer-donate { grid-column: 1 / -1; display: flex; justify-content: center; padding-top: 8px; }
          .nf-donation-form { width: min(390px, 100%); border: 1px solid var(--nf-accent); border-radius: var(--nf-radius); background: color-mix(in srgb, var(--nf-bg) 88%, #000); padding: 16px; box-shadow: 0 0 24px color-mix(in srgb, var(--nf-accent) 24%, transparent); text-align: left; }
          .nf-donation-label { display: block; margin-bottom: 10px; color: var(--nf-accent-2); font: 900 10px/1.3 var(--nf-font); letter-spacing: .1em; text-transform: uppercase; }
          .nf-donation-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
          .nf-donation-input-wrap { display: flex; align-items: center; border: 1px solid var(--nf-accent-2); border-radius: var(--nf-radius); background: #07050f; color: var(--nf-accent-2); box-shadow: inset 0 0 12px color-mix(in srgb, var(--nf-accent-2) 13%, transparent); }
          .nf-donation-currency { padding-left: 11px; font: 900 13px/1 var(--nf-font); }
          .nf-donation-input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: var(--nf-text); padding: 10px 11px 10px 7px; font: 900 13px/1 var(--nf-font); }
          .nf-donation-input:focus { box-shadow: inset 0 -1px 0 var(--nf-accent); }
          .nf-donation-cancel { margin-top: 10px; border: 0; background: transparent; color: var(--nf-muted); padding: 0; font: 800 9px/1 var(--nf-font); letter-spacing: .08em; text-decoration: underline; cursor: pointer; }
          .nf-donation-cancel:disabled { cursor: wait; opacity: .55; }
          .nf-donation-error { margin: 9px 0 0; color: #ff5c8a; font: 800 9px/1.45 var(--nf-font); letter-spacing: .04em; }
          .nf-donate-spinner { width: 11px; height: 11px; border: 2px solid color-mix(in srgb, var(--nf-accent) 28%, transparent); border-top-color: var(--nf-accent); border-radius: 999px; animation: nf-donate-spin .7s linear infinite; }
          @keyframes nf-donate-spin { to { transform: rotate(360deg); } }
          .nf-footer-thanks { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 7px; padding-top: 2px; }
          .nf-footer-open-source { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 9px; padding-top: 10px; text-align: center; font-family: var(--nf-font); }
          .nf-open-source-links { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 9px; }
          .nf-open-source-github, .nf-license-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; border-radius: var(--nf-radius); padding: 8px 11px; font: 900 9px/1 var(--nf-font); letter-spacing: .1em; text-decoration: none; transition: transform .2s ease, filter .2s ease, box-shadow .2s ease; }
          .nf-open-source-github { border: 1px solid var(--nf-accent-2); color: var(--nf-accent-2); box-shadow: 0 0 14px color-mix(in srgb, var(--nf-accent-2) 25%, transparent); }
          .nf-license-badge { border: 1px solid var(--nf-accent); background: color-mix(in srgb, var(--nf-accent) 10%, transparent); color: var(--nf-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--nf-accent) 20%, transparent); }
          .nf-open-source-github:hover, .nf-license-badge:hover { transform: translateY(-2px); filter: brightness(1.18); box-shadow: 0 0 22px color-mix(in srgb, var(--nf-accent) 38%, transparent); }
          .nf-open-source-copy { max-width: 620px; margin: 0; color: var(--nf-muted); font-size: 9px; line-height: 1.7; letter-spacing: .08em; }
          .nf-footer-heart { display: inline-block; background: linear-gradient(135deg, #ff2bd6 0%, #ff3158 52%, #ff8a00 100%); background-clip: text; -webkit-background-clip: text; color: transparent; -webkit-text-fill-color: transparent; font-size: 15px; line-height: 1; filter: drop-shadow(0 0 6px rgba(255, 43, 214, .8)); transform-origin: center; animation: nf-footer-heartbeat .8s ease-in-out infinite; }
          .nf-landing[data-neoflash-theme="cyberpunk"] .nf-hero::after { opacity: 1; background: repeating-linear-gradient(0deg, rgba(0,0,0,.05) 0, rgba(0,0,0,.05) 2px, transparent 2px, transparent 4px); }
          .nf-landing[data-neoflash-theme="cyberpunk"] .nf-wordmark, .nf-landing[data-neoflash-theme="cyberpunk"] .nf-hero-title { text-shadow: 0 0 10px var(--nf-accent), 0 0 28px color-mix(in srgb, var(--nf-accent) 65%, transparent); animation: nf-cyber-flicker 6s steps(1, end) infinite; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-nav { background: rgba(255,255,255,.88); }
          .nf-landing[data-neoflash-theme="minimal"] .nf-primary-action, .nf-landing[data-neoflash-theme="minimal"] .nf-nav-action, .nf-landing[data-neoflash-theme="minimal"] .nf-neon-cta, .nf-landing[data-neoflash-theme="minimal"] .nf-donate-btn { animation: none; box-shadow: none; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-eyebrow, .nf-landing[data-neoflash-theme="minimal"] .nf-section-kicker, .nf-landing[data-neoflash-theme="minimal"] .nf-nav-meta { animation: none; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-hero-layout { grid-template-columns: .78fr 1.22fr; align-items: start; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-hero-copy { margin-top: 9vh; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-manifesto { font-size: clamp(52px, 8.8vw, 112px); letter-spacing: -.08em; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-hero-title { font-size: clamp(30px, 4.2vw, 54px); letter-spacing: -.045em; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-hero-aside { align-self: center; border-width: 0 0 0 3px; box-shadow: none; backdrop-filter: none; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-feature-grid { gap: 1px; background: var(--nf-border); }
          .nf-landing[data-neoflash-theme="minimal"] .nf-feature-card { border: 0; box-shadow: none; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-demo-shell { grid-template-columns: .78fr 1.22fr; }
          .nf-landing[data-neoflash-theme="minimal"] .nf-demo-canvas { order: 2; border-right: 0; border-left: 1px solid var(--nf-border); }
          .nf-landing[data-neoflash-theme="retro"] { text-transform: uppercase; image-rendering: pixelated; }
          .nf-landing[data-neoflash-theme="retro"] .nf-hero::after { opacity: .18; background-image: linear-gradient(var(--nf-accent) 2px, transparent 2px), linear-gradient(90deg, var(--nf-accent-2) 2px, transparent 2px); background-size: 32px 32px; }
          .nf-landing[data-neoflash-theme="retro"] .nf-hero-copy { border: 4px solid var(--nf-accent); background: #000; padding: clamp(24px, 4vw, 48px); box-shadow: 12px 12px 0 var(--nf-accent-2); }
          .nf-landing[data-neoflash-theme="retro"] .nf-manifesto { font-size: clamp(46px, 7vw, 88px); letter-spacing: -.04em; }
          .nf-landing[data-neoflash-theme="retro"] .nf-hero-title { font-size: clamp(28px, 3.8vw, 46px); letter-spacing: -.025em; }
          .nf-landing[data-neoflash-theme="retro"] .nf-feature-card, .nf-landing[data-neoflash-theme="retro"] .nf-demo-shell { border-width: 4px; }
          .nf-landing[data-neoflash-theme="retro"] .nf-feature-card:nth-child(2) { border-color: var(--nf-accent-2); }
          .nf-landing[data-neoflash-theme="retro"] .nf-primary-action { border-width: 4px; box-shadow: 8px 8px 0 var(--nf-accent-2); }
          .nf-landing[data-neoflash-theme="space"] .nf-nav, .nf-landing[data-neoflash-theme="space"] .nf-feature-card, .nf-landing[data-neoflash-theme="space"] .nf-demo-shell, .nf-landing[data-neoflash-theme="space"] .nf-hero-aside { backdrop-filter: blur(22px); }
          .nf-landing[data-neoflash-theme="space"] .nf-hero-layout { grid-template-columns: 1fr; text-align: center; }
          .nf-landing[data-neoflash-theme="space"] .nf-hero-copy { margin: auto; }
          .nf-landing[data-neoflash-theme="space"] .nf-hero-copy p { margin-inline: auto; }
          .nf-landing[data-neoflash-theme="space"] .nf-hero-aside { width: min(470px, 100%); margin: 0 auto; animation: nf-space-float 5s ease-in-out infinite; }
          .nf-landing[data-neoflash-theme="space"] .nf-section-title { letter-spacing: .02em; }
          @media (max-width: 820px) {
            .nf-nav { padding-right: 66px; }
            .nf-nav-logo { width: 150px; height: 46px; }
            .nf-nav-links, .nf-nav-meta, .nf-nav-action { display: none; }
            .nf-hero { min-height: auto; }
            .nf-hero-layout { grid-template-columns: 1fr !important; padding: 88px 18px 40px; }
            .nf-hero-brand { width: min(300px, 72vw); height: 80px; margin-bottom: 8px; }
            .nf-manifesto, .nf-landing[data-neoflash-theme="minimal"] .nf-manifesto, .nf-landing[data-neoflash-theme="retro"] .nf-manifesto { margin-top: 12px; font-size: clamp(48px, 15vw, 72px); line-height: .82; }
            .nf-hero-title, .nf-landing[data-neoflash-theme="minimal"] .nf-hero-title, .nf-landing[data-neoflash-theme="retro"] .nf-hero-title { min-height: 2em; margin-top: 18px; font-size: clamp(28px, 8.5vw, 40px); }
            .nf-landing[data-neoflash-theme="minimal"] .nf-hero-copy { margin-top: 0; }
            .nf-section { padding: 36px 16px; }
            .nf-section-title { margin-top: 10px; font-size: clamp(30px, 9vw, 42px); line-height: 1; }
            .nf-feature-canvas { height: auto; aspect-ratio: 4 / 5; margin-top: 22px; }
            .nf-hero-aside { display: none; }
            .nf-feature-grid { grid-template-columns: 1fr; }
            .nf-demo-shell { grid-template-columns: 1fr !important; margin-top: 24px; }
            .nf-demo-canvas { min-height: 0; aspect-ratio: 16 / 9; order: 0 !important; border-right: 0; border-left: 0 !important; border-bottom: 1px solid var(--nf-border); }
            .nf-demo-copy { padding: 26px 22px 30px; }
            .nf-demo-copy h2 { margin-top: 10px; }
            .nf-demo-copy p { margin-top: 14px; line-height: 1.65; }
            .nf-demo-tabs { margin-top: 20px; }
            .nf-demo-tab { min-height: 36px; padding: 10px 12px; font-size: 10px; }
            .nf-demo-stamp { top: 8px; right: 8px; bottom: auto; }
            .nf-footer { grid-template-columns: 1fr; justify-items: center; gap: 16px; text-align: center; }
            .nf-footer > .nf-nav-logo, .nf-footer > .nf-nav-links, .nf-footer-right { justify-self: center; }
            .nf-footer .nf-nav-links { display: block; width: min(360px, 100%); }
            .nf-footer-right { flex-direction: column; justify-content: center; text-align: center; }
            .nf-footer-donate, .nf-footer-thanks { grid-column: 1; width: 100%; }
          }
          @media (prefers-reduced-motion: reduce) {
            .nf-theme-stage, .nf-feature-card, .nf-primary-action, .nf-reveal { transition: none; }
            .nf-manifesto, .nf-hero-title, .nf-hero-aside, .nf-primary-action, .nf-nav-action, .nf-neon-cta, .nf-donate-btn, .nf-donate-spinner, .nf-footer-heart, .nf-eyebrow, .nf-section-kicker, .nf-nav-meta, .nf-type-cursor { animation: none !important; }
            .nf-reveal { opacity: 1; transform: none; }
          }

          /* ── NEW UNIQUE ANIMATIONS ── */
          @keyframes nf-crt-on {
            0%   { transform: scaleY(0.025); filter: brightness(3) saturate(2); }
            18%  { transform: scaleY(0.025); filter: brightness(2); }
            72%  { transform: scaleY(1);     filter: brightness(1.15); }
            100% { transform: scaleY(1);     filter: brightness(1); }
          }
          @keyframes nf-scanbeam-sweep {
            0%   { top: 0;               opacity: .95; }
            80%  { opacity: .7; }
            100% { top: calc(100% - 3px); opacity: 0; }
          }

          /* ── nav hotspots overlay ── */
          .nf-nav-links-i { position: relative; }
          .nf-nav-hotspots { position: absolute; inset: 0; display: flex; align-items: stretch; }
          .nf-nav-hs {
            flex: 1; background: transparent; border: none; cursor: pointer; color: transparent;
            font-size: 0; padding: 0; transition: background .15s;
          }
          .nf-nav-hs:hover { background: color-mix(in srgb, var(--nf-accent) 10%, transparent); border-radius: 4px; }
          .nf-nav-hs:first-child { flex: 2; }
          .nf-nav-hs:nth-child(2) { flex: 1.4; }
          .nf-nav-hs:last-child { flex: 1.6; }

          /* ── popup backdrop ── */
          .nf-popup-backdrop {
            position: fixed; inset: 0; z-index: 120;
            display: flex; align-items: center; justify-content: center;
            padding: 16px;
            background: rgba(0,0,0,.72);
            backdrop-filter: blur(6px);
            animation: nf-fade-in .18s ease both;
          }
          @keyframes nf-fade-in { from { opacity: 0; } to { opacity: 1; } }

          /* ── popup card — CRT power-on entry ── */
          .nf-popup-card {
            position: relative; overflow: hidden;
            width: min(580px, 100%);
            background: var(--nf-card-bg, color-mix(in srgb, var(--nf-bg) 85%, #000));
            border: 1.5px solid var(--nf-accent);
            border-radius: calc(var(--nf-radius) * 1.4);
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--nf-accent) 18%, transparent),
                        0 0 38px color-mix(in srgb, var(--nf-accent) 28%, transparent),
                        0 24px 80px rgba(0,0,0,.6);
            animation: nf-crt-on .45s cubic-bezier(.16,1,.3,1) both;
            transform-origin: center center;
          }

          /* ── scan beam (the unique sweeping glowing line) ── */
          .nf-scanbeam {
            position: absolute; left: 0; right: 0; top: 0; height: 3px; z-index: 10; pointer-events: none;
            background: linear-gradient(90deg,
              transparent 0%,
              color-mix(in srgb, var(--nf-accent) 60%, transparent) 20%,
              var(--nf-accent) 50%,
              color-mix(in srgb, var(--nf-accent) 60%, transparent) 80%,
              transparent 100%);
            box-shadow: 0 0 8px 3px color-mix(in srgb, var(--nf-accent) 55%, transparent);
            animation: nf-scanbeam-sweep .7s ease-out .3s both;
          }

          /* ── popup inner sections ── */
          .nf-popup-hdr {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px 10px;
            border-bottom: 1px solid color-mix(in srgb, var(--nf-accent) 22%, transparent);
          }
          .nf-popup-tabs { display: flex; gap: 4px; }
          .nf-popup-tab {
            padding: 5px 12px;
            background: transparent;
            border: 1px solid color-mix(in srgb, var(--nf-accent) 28%, transparent);
            border-radius: var(--nf-radius);
            color: var(--nf-muted);
            font: 900 9px/1 var(--nf-font);
            letter-spacing: .14em;
            cursor: pointer;
            transition: border-color .15s, color .15s, background .15s;
          }
          .nf-popup-tab.active,
          .nf-popup-tab:hover {
            border-color: var(--nf-accent);
            color: var(--nf-accent);
            background: color-mix(in srgb, var(--nf-accent) 8%, transparent);
          }
          .nf-popup-x {
            background: transparent; border: none; cursor: pointer;
            color: var(--nf-muted); font-size: 14px; line-height: 1;
            padding: 4px 6px; border-radius: 4px; transition: color .12s;
          }
          .nf-popup-x:hover { color: var(--nf-accent); }
          .nf-popup-body { padding: 20px 20px 12px; }
          .nf-popup-kicker {
            color: var(--nf-accent); font: 1000 9px/1 var(--nf-font); letter-spacing: .22em;
            margin-bottom: 8px;
          }
          .nf-popup-title {
            margin: 0 0 12px;
            color: var(--nf-text);
            font: 1000 clamp(20px, 4vw, 28px)/1.05 var(--nf-font);
            letter-spacing: -.04em;
          }
          .nf-popup-desc {
            margin: 0 0 16px;
            color: var(--nf-muted);
            font-size: 13px; line-height: 1.7;
            max-width: 520px;
          }
          .nf-popup-canvas {
            width: 300px; height: 90px;
            border: 1px solid color-mix(in srgb, var(--nf-accent) 18%, transparent);
            border-radius: var(--nf-radius);
            overflow: hidden;
            background: color-mix(in srgb, var(--nf-bg) 60%, #000);
          }
          .nf-popup-canvas--demo {
            width: 100%; height: 160px;
          }
          .nf-popup-footer {
            padding: 12px 20px 16px;
            border-top: 1px solid color-mix(in srgb, var(--nf-accent) 14%, transparent);
          }
          .nf-popup-cta {
            background: transparent;
            border: 1.5px solid var(--nf-accent);
            border-radius: var(--nf-radius);
            color: var(--nf-accent);
            font: 900 10px/1 var(--nf-font);
            letter-spacing: .1em;
            padding: 10px 18px;
            cursor: pointer;
            transition: background .15s, color .15s;
          }
          .nf-popup-cta:hover {
            background: var(--nf-accent);
            color: var(--nf-bg);
          }

          /* ── reduced motion: skip CRT entry ── */
          @media (prefers-reduced-motion: reduce) {
            .nf-popup-card { animation: none; }
            .nf-scanbeam { display: none; }
          }
        `}</style>

        <ThemeSwitcher activeTheme={landingTheme} disabled={themeTransitioning} onSelect={switchLandingTheme} />

        <div className="nf-theme-stage">
          <section className="nf-hero">
            <div className="nf-hero-canvas" aria-hidden="true">
              <NeoFlashCanvas scene={themeHeroScene} running={true} runKey={themeRunKey} onFps={() => undefined} />
            </div>
            <div className="nf-hero-shade" aria-hidden="true" />
            <nav className="nf-nav" aria-label="NeoFlash navigation">
              <div className="nf-nav-logo" aria-label="NeoFlash"><NeoFlashCanvas scene={logoScene} running={true} runKey={themeRunKey + 20} onFps={() => undefined} /></div>
              <div className="nf-nav-links nf-nav-links-i" aria-label="Features, demos, and export">
                <NeoFlashCanvas scene={navLinksScene} running={true} runKey={themeRunKey + 21} onFps={() => undefined} />
                <div className="nf-nav-hotspots" aria-hidden="false">
                  <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('features')} aria-label="Open Features info"><span>FEATURES</span></button>
                  <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('demos')} aria-label="Open Demos info"><span>DEMOS</span></button>
                  <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('export')} aria-label="Open Export info"><span>EXPORT</span></button>
                </div>
              </div>
              <button type="button" className="nf-nav-action" onClick={openLogin}>OPEN PLAYGROUND</button>
            </nav>

            <div
              className="nf-hero-layout"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? 'none' : 'translateY(18px)',
                transition: 'opacity .7s ease, transform .7s ease',
              }}
            >
              <div className="nf-hero-copy">
                <div className="nf-hero-brand" aria-label="NeoFlash animated logo"><NeoFlashCanvas scene={logoScene} running={true} runKey={themeRunKey + 22} onFps={() => undefined} /></div>
                <div className="nf-eyebrow">LIVE THEME // {activeTheme.label}</div>
                <h1 className="nf-manifesto" aria-label="FLASH IS NOT DEAD">
                  <span>FLASH IS</span>
                  <span className="nf-manifesto-punch">NOT DEAD</span>
                </h1>
                <h2 className="nf-hero-title"><TypewriterText text="Describe it. Animate it. Instantly." /></h2>
                <p className="nf-reveal">NeoFlash turns plain-language ideas into editable, browser-native motion. This page is running the same scene engine you will use inside.</p>
                <button type="button" className="nf-primary-action" onClick={openLogin} data-testid="button-open-login">OPEN THE PLAYGROUND <ArrowRight size={17} /></button>
              </div>
              <aside className="nf-hero-aside nf-reveal">
                <strong>SCENE // {activeTheme.cardStyle.toUpperCase()}</strong>
                <span>SVG vector · live timeline · no plugin<br />Theme persisted locally as “{landingTheme}”</span>
              </aside>
            </div>
          </section>

          <section className="nf-section" aria-label="NeoFlash features">
            <div className="nf-section-inner">
              <div className="nf-section-kicker">ONE LANGUAGE // MANY WORLDS</div>
              <h2 className="nf-section-title nf-reveal">The landing page is the product demo.</h2>
              <div className="nf-feature-canvas nf-reveal" aria-label="Three Ways In — NeoFlash feature cards">
                <NeoFlashCanvas scene={featureScene} running={true} runKey={themeRunKey + 23} onFps={() => undefined} />
              </div>
            </div>
          </section>

          <section className="nf-section" aria-label="NeoFlash live demos">
            <div className="nf-section-inner">
              <div className="nf-section-kicker">LIVE SCENES // {activeTheme.label}</div>
              <div className="nf-demo-shell">
                <div className="nf-demo-canvas">
                  <div className="absolute inset-0">
                    <NeoFlashCanvas scene={themedDemoScene} running={true} runKey={themeRunKey + selectedDemo + 1} onFps={() => undefined} />
                  </div>
                  <div className="nf-demo-stamp">SVG // {themedDemoScene.stage.width} × {themedDemoScene.stage.height}</div>
                </div>
                <div className="nf-demo-copy">
                  <div className="nf-section-kicker">SELECT // REMIX</div>
                  <h2 className="nf-reveal">Start from a scene. Make it yours.</h2>
                  <p className="nf-reveal">Each theme ships a different NeoFlash composition and symbol vocabulary. Select a scene to watch the renderer redraw it instantly.</p>
                  <div className="nf-demo-tabs">
                    {activeTheme.demoScenes.map((demo, index) => (
                      <button
                        key={demo.label}
                        type="button"
                        className="nf-demo-tab"
                        onClick={() => setSelectedDemo(index)}
                        aria-pressed={selectedDemo === index}
                      >
                        {demo.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="nf-section nf-final-cta" aria-label="Start animating">
            <div className="nf-section-inner">
              <div className="nf-section-kicker">READY // SET // MOTION</div>
              <h2 className="nf-section-title"><TypewriterText text="Ready to animate?" replayOnView /></h2>
              <div className="nf-neon-cta" data-testid="button-open-login-footer" aria-label="Start animating free">
                <NeoFlashCanvas scene={finalCtaScene} running={true} runKey={themeRunKey + 26} onFps={() => undefined} onSymbolClick={openLogin} />
              </div>
            </div>
          </section>

          <footer className="nf-footer">
            <div className="nf-nav-logo" aria-label="NeoFlash"><NeoFlashCanvas scene={logoScene} running={true} runKey={themeRunKey + 24} onFps={() => undefined} /></div>
            <div className="nf-nav-links nf-nav-links-i" aria-label="Features, demos, and export">
              <NeoFlashCanvas scene={navLinksScene} running={true} runKey={themeRunKey + 25} onFps={() => undefined} />
              <div className="nf-nav-hotspots" aria-hidden="false">
                <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('features')} aria-label="Open Features info"><span>FEATURES</span></button>
                <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('demos')} aria-label="Open Demos info"><span>DEMOS</span></button>
                <button type="button" className="nf-nav-hs" onClick={() => setNavPopup('export')} aria-label="Open Export info"><span>EXPORT</span></button>
              </div>
            </div>
            <div className="nf-footer-right">
              <span className="nf-reveal">DESCRIBE IT · ANIMATE IT · INSTANTLY · © 2026</span>
            </div>
            <div className="nf-footer-donate">
              {!donationOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setDonationError('');
                    setDonationOpen(true);
                  }}
                  className="nf-donate-btn"
                >
                  DONATE ♥
                </button>
              ) : (
                <form className="nf-donation-form" onSubmit={createDonationSession}>
                  <label className="nf-donation-label" htmlFor="neoflash-donation-amount">
                    Choose your amount (€)
                  </label>
                  <div className="nf-donation-controls">
                    <div className="nf-donation-input-wrap">
                      <span className="nf-donation-currency" aria-hidden="true">€</span>
                      <input
                        id="neoflash-donation-amount"
                        type="text"
                        inputMode="decimal"
                        value={donationAmount}
                        onChange={(event) => {
                          setDonationAmount(event.target.value);
                          setDonationError('');
                        }}
                        disabled={donationLoading}
                        autoFocus
                        className="nf-donation-input"
                        aria-describedby={donationError ? 'neoflash-donation-error' : undefined}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={donationLoading}
                      aria-busy={donationLoading}
                      className="nf-donate-btn"
                    >
                      {donationLoading && <span className="nf-donate-spinner" aria-hidden="true" />}
                      {donationLoading ? 'CREATING...' : 'DONATE'}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="nf-donation-cancel"
                    disabled={donationLoading}
                    onClick={() => {
                      setDonationOpen(false);
                      setDonationError('');
                    }}
                  >
                    Cancel
                  </button>
                  {donationError && (
                    <p id="neoflash-donation-error" className="nf-donation-error" role="alert">
                      {donationError}
                    </p>
                  )}
                </form>
              )}
            </div>
            <div className="nf-footer-thanks">
              <span className="nf-footer-heart" aria-hidden="true">♥</span>
              <span>thanks to audos.com</span>
            </div>
            <div className="nf-footer-open-source">
              <div className="nf-open-source-links">
                <a
                  className="nf-open-source-github"
                  href="https://github.com/joekandy/NeoFlash"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  ⭐ OPEN SOURCE ON GITHUB
                </a>
                <a
                  className="nf-license-badge"
                  href="https://github.com/joekandy/NeoFlash/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Read the NeoFlash MIT License"
                >
                  MIT LICENSE
                </a>
              </div>
              <p className="nf-open-source-copy"><em>NeoFlash is free and open source. Fork it, remix it, make the web move again.</em></p>
            </div>
          </footer>
        </div>

        {navPopup && (
          <div
            className="nf-popup-backdrop"
            onClick={() => setNavPopup(null)}
            role="dialog"
            aria-modal="true"
            aria-label={navPopup === 'features' ? 'Features info' : navPopup === 'demos' ? 'Demos info' : 'Export info'}
          >
            <div className="nf-popup-card" onClick={e => e.stopPropagation()}>
              {/* CRT scan beam — the unique new animation */}
              <div className="nf-scanbeam" aria-hidden="true" />

              {/* header */}
              <div className="nf-popup-hdr">
                <div className="nf-popup-tabs">
                  {(['features', 'demos', 'export'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      className={`nf-popup-tab${navPopup === tab ? ' active' : ''}`}
                      onClick={() => setNavPopup(tab)}
                    >
                      {tab.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button type="button" className="nf-popup-x" onClick={() => setNavPopup(null)} aria-label="Close">✕</button>
              </div>

              {/* body */}
              <div className="nf-popup-body">
                {navPopup === 'features' && (
                  <>
                    <div className="nf-popup-kicker">01 // THE LANGUAGE</div>
                    <h3 className="nf-popup-title">Declarative animation.<br />Zero plugins.</h3>
                    <p className="nf-popup-desc">NeoFlash is a structured language that runs entirely in your browser. Describe symbols, wire events, set animation rules — the SVG renderer brings every frame to life in real time. No After Effects. No export pipeline. No plugin.</p>
                    <div className="nf-popup-canvas">
                      <NeoFlashCanvas scene={popupFeaturesScene} running={true} runKey={themeRunKey + 40} onFps={() => undefined} />
                    </div>
                  </>
                )}
                {navPopup === 'demos' && (
                  <>
                    <div className="nf-popup-kicker">02 // LIVE SCENES</div>
                    <h3 className="nf-popup-title">Start from a scene.<br />Make it yours.</h3>
                    <p className="nf-popup-desc">Every theme ships pre-built NeoFlash compositions — Highway Bar, City Rain, Emotions, Pong and more. Select a scene on the main page to watch the timeline engine redraw it instantly, then open the Playground to edit the code line by line.</p>
                    <div className="nf-popup-canvas nf-popup-canvas--demo">
                      <NeoFlashCanvas scene={popupDemosScene} running={true} runKey={themeRunKey + 41} onFps={() => undefined} />
                    </div>
                  </>
                )}
                {navPopup === 'export' && (
                  <>
                    <div className="nf-popup-kicker">03 // YOUR CODE</div>
                    <h3 className="nf-popup-title">Edit every line.<br />Ship to the web.</h3>
                    <p className="nf-popup-desc">Everything in NeoFlash is plain text you own. Edit a line in Advanced mode, save the scene to your account, and share the URL. The full symbol cheatsheet, autocomplete, and line numbers are built into the Playground — no separate editor required.</p>
                    <div className="nf-popup-canvas">
                      <NeoFlashCanvas scene={popupExportScene} running={true} runKey={themeRunKey + 42} onFps={() => undefined} />
                    </div>
                  </>
                )}
              </div>

              <div className="nf-popup-footer">
                <button type="button" className="nf-popup-cta" onClick={openLogin}>OPEN PLAYGROUND →</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* AUDOS:LANDING_SHELL:END */}

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 backdrop-blur-sm"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-gate-login-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setLoginOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md relative overflow-hidden rounded-3xl"
            style={{ backgroundColor: panelStrongColor, boxShadow: '0 30px 70px rgba(0,0,0,0.35)' }}
          >
            <button
              type="button"
              onClick={() => setLoginOpen(false)}
              disabled={loading}
              aria-label="Close login"
              className="absolute right-3 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:opacity-80"
              style={{ backgroundColor: bgLight, color: textPrimary }}
            >
              <X size={18} strokeWidth={2.6} />
            </button>
            <div className="p-6 sm:p-8">
              <h2 id="email-gate-login-title" className="text-2xl font-extrabold mb-1" style={{ color: textPrimary }}>
                Open {brandName}
              </h2>
              <p className="text-sm mb-5" style={{ color: textMuted }}>
                Continue with email to enter the NeoFlash playground.
              </p>
              {renderLoginPanel(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
