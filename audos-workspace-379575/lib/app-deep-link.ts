/**
 * Deep-link resolution for the v4 shell.
 *
 * Two entry points can ask the shell to open something: the `openApp` custom
 * event dispatched by `app://<id>` markdown links in the assistant, and the
 * URL hash (`#<id>`, browser back/forward). Both used to carry their own
 * matching rules, and the `openApp` one had none at all — it set the active
 * panel to whatever id arrived, so a stale or parameterised id rendered a
 * blank main area with only the dock and sidebar left.
 *
 * This module is the single resolver both paths run through. It is pure so it
 * can be tested directly, and so the two paths cannot drift apart again.
 */

export interface DeepLinkApp {
  id: string;
  name?: string;
}

/** Panels the shell can render that are not entries in `config.apps`. */
export const BUILT_IN_PANEL_TARGETS: Record<string, string> = {
  files: 'files',
  memory: 'files',
  settings: 'settings',
};

/**
 * Normalise a raw deep-link target: drop an `app://` scheme if the caller
 * didn't already strip it, drop any `?query` / `#fragment` suffix (the system
 * prompt documents `app://app-id?drill=pump-drill`, and the query string used
 * to stay glued to the id so nothing ever matched), trim, and lowercase.
 */
export function normalizeDeepLinkTarget(rawTarget: unknown): string {
  if (typeof rawTarget !== 'string') return '';

  let target = rawTarget.trim();
  if (!target) return '';

  if (target.toLowerCase().startsWith('app://')) {
    target = target.slice('app://'.length);
  }

  const suffixIndex = target.search(/[?#]/);
  if (suffixIndex !== -1) {
    target = target.slice(0, suffixIndex);
  }

  return target.trim().toLowerCase();
}

/**
 * Resolve a deep-link target to a panel the shell can actually render.
 *
 * Returns the canonical panel id (an app's own `id`, or `files`/`settings`),
 * or `null` when nothing matches — callers must fall back to their
 * unrecognised-route behaviour rather than opening a panel that renders
 * nothing.
 */
export function resolveDeepLinkPanelId(
  rawTarget: unknown,
  apps: ReadonlyArray<DeepLinkApp> | null | undefined,
): string | null {
  const target = normalizeDeepLinkTarget(rawTarget);
  if (!target) return null;

  const appList = Array.isArray(apps) ? apps : [];

  const byId = appList.find(
    app => typeof app?.id === 'string' && app.id.toLowerCase() === target,
  );
  if (byId) return byId.id;

  const byName = appList.find(
    app => typeof app?.name === 'string' && app.name.toLowerCase() === target,
  );
  if (byName) return byName.id;

  const builtIn = BUILT_IN_PANEL_TARGETS[target];
  if (builtIn) return builtIn;

  return null;
}
