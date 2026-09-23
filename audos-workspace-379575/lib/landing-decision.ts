/**
 * Landing-view decision seam for the v4 desktop shell.
 *
 * The shell writes the open panel's id into the URL hash, so every reload of
 * an app-first space arrives carrying what looks like a deep link. Deciding
 * "deep link vs app home" inside the mount effect meant the deep-link branch
 * silently defeated `desktop.layout.defaultLandingView: 'app'`. The decision
 * lives here instead: one pure function, directly testable, with no React or
 * DOM dependency.
 */

export interface LandingApp {
  id: string;
  name: string;
}

export interface LandingLayoutConfig {
  defaultLandingView?: string;
  defaultLandingAppId?: string;
}

export type LandingDecision =
  | {
      kind: 'app-home';
      appId: string;
      appName: string;
      source: 'deep_link' | 'default_landing';
    }
  | { kind: 'panel'; panelId: string }
  | { kind: 'agent' };

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * The app the space wants visitors to land on, or null for agent-first spaces
 * (and legacy configs where `desktop.layout` predates the landing fields).
 */
export function resolveDefaultLandingApp<T extends LandingApp>(
  apps: T[] | null | undefined,
  layout: LandingLayoutConfig | null | undefined,
): T | null {
  const list = apps || [];
  if (normalize(layout?.defaultLandingView) !== 'app') return null;
  if (!list.length) return null;
  const wanted = normalize(layout?.defaultLandingAppId);
  const byId = wanted
    ? list.find(app => app.id.toLowerCase() === wanted)
    : undefined;
  return byId || list[0];
}

/**
 * Map a URL hash (or `?app=` / `initialAppId` value) onto the panel it opens,
 * or null when it names nothing this shell knows about.
 */
export function resolvePanelIdForHash(
  hash: string | null | undefined,
  apps: LandingApp[] | null | undefined,
): string | null {
  const wanted = normalize(hash);
  if (!wanted) return null;

  const matchingApp = (apps || []).find(
    app => app.id.toLowerCase() === wanted || app.name.toLowerCase() === wanted,
  );
  if (matchingApp) return matchingApp.id;

  if (wanted === 'files' || wanted === 'memory') return 'files';
  if (wanted === 'settings') return 'settings';
  return null;
}

/**
 * True when a `hashchange` names the panel that is already open. The shell
 * rewrites the hash itself whenever the panel changes, so these events carry
 * no navigation intent — re-opening the panel would collapse an expanded
 * app home back into the side panel.
 */
export function hashTargetsOpenPanel(
  hash: string | null | undefined,
  activePanelId: string | null | undefined,
  apps: LandingApp[] | null | undefined,
): boolean {
  if (!activePanelId) return false;
  const target = resolvePanelIdForHash(hash, apps);
  return target !== null && target === activePanelId;
}

/**
 * Decide what the shell shows on initial mount.
 *
 * A deep link naming the configured default landing app lands in app home —
 * that is the same destination, just reached via the hash the shell wrote
 * itself. Any other deep link keeps today's side-panel behaviour.
 */
export function resolveLandingDecision(input: {
  deepLinkId?: string | null;
  apps?: LandingApp[] | null;
  layout?: LandingLayoutConfig | null;
}): LandingDecision {
  const apps = input.apps || [];
  const defaultLandingApp = resolveDefaultLandingApp(apps, input.layout);
  const deepLinkId = normalize(input.deepLinkId);

  if (deepLinkId) {
    const matchingApp = apps.find(
      app =>
        app.id.toLowerCase() === deepLinkId ||
        app.name.toLowerCase() === deepLinkId,
    );

    if (matchingApp) {
      if (defaultLandingApp && defaultLandingApp.id === matchingApp.id) {
        return {
          kind: 'app-home',
          appId: matchingApp.id,
          appName: matchingApp.name,
          source: 'deep_link',
        };
      }
      return { kind: 'panel', panelId: matchingApp.id };
    }

    if (deepLinkId === 'files' || deepLinkId === 'memory') {
      return { kind: 'panel', panelId: 'files' };
    }
    if (deepLinkId === 'settings') {
      return { kind: 'panel', panelId: 'settings' };
    }
  }

  if (defaultLandingApp) {
    return {
      kind: 'app-home',
      appId: defaultLandingApp.id,
      appName: defaultLandingApp.name,
      source: 'default_landing',
    };
  }

  return { kind: 'agent' };
}
