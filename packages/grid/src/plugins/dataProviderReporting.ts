/**
 * How a data-provider failure reaches the person looking at the grid.
 *
 * Fetching and writing are the plugin's own business; showing a failure is
 * somebody else's. It is a message raised through the notification plugin, in
 * the reader's language, sometimes with a button on it — none of which the
 * request paths should have to know. Keeping it here also gives the plugin's
 * two dependencies on other plugins one address, so a change to either of them
 * is a change to one file rather than a search through six hundred lines.
 */

import { PHRASE } from '../i18n/keys.js';
import type { Grid } from '../grid.js';
import type { Loading } from './loading.js';
import type { MutationOperation } from '../settings.js';
import type { Notification } from './notification.js';

/** What was being attempted. `fetch` is the reading half. */
export type FailedOperation = MutationOperation | 'fetch';

/** What to call each failure, before the detail dug out of the error. */
const TITLES: Record<FailedOperation, string> = {
  fetch: PHRASE.DATA_PROVIDER_ERROR_FETCH,
  create: PHRASE.DATA_PROVIDER_ERROR_CREATE,
  update: PHRASE.DATA_PROVIDER_ERROR_UPDATE,
  remove: PHRASE.DATA_PROVIDER_ERROR_REMOVE,
};

/**
 * Digs a message out of whatever was thrown.
 *
 * An HTTP client rejects with its own shape, and the useful sentence is usually
 * buried in a JSON body one or two levels down. Showing "[object Object]" to a
 * reader who could have been told "SKU already exists" is a real cost, so the
 * likely places are tried in order before falling back.
 */
export function messageOf(error: unknown, fallback: string): string {
  const bodies = [
    error,
    (error as { response?: { data?: unknown } } | null)?.response?.data,
    (error as { data?: unknown } | null)?.data,
    (error as { body?: unknown } | null)?.body,
  ];
  for (const body of bodies) {
    if (typeof body === 'string' && body !== '') {
      return body;
    }
    for (const key of ['message', 'error', 'detail'] as const) {
      const value = (body as Record<string, unknown> | null | undefined)?.[key];
      if (typeof value === 'string' && value !== '') {
        return value;
      }
    }
  }
  return fallback;
}

/**
 * Shows what went wrong, when there is somewhere to show it.
 *
 * A failed load is the one kind the reader can retry themselves, so it gets a
 * button and no timeout — a message about missing data that disappears after
 * four seconds is worse than none. `retry` is what that button does, and it is
 * passed in because only the plugin knows which query is the current one.
 */
export function reportProviderError(
  grid: Grid,
  error: unknown,
  operation: FailedOperation,
  retry: () => void,
): void {
  const notification = grid.getPlugin<Notification>('notification');
  if (!notification) {
    return;
  }
  const title = grid.getTranslatedPhrase(TITLES[operation]);
  const fallback = grid.getTranslatedPhrase(PHRASE.DATA_PROVIDER_ERROR_REQUEST_FAILED);
  const detail = messageOf(error, fallback);
  notification.showMessage({
    message: `${title}: ${detail}`,
    type: 'error',
    // A fetch toast stays until it is answered, so it needs an id or a grid
    // that cannot reach its server piles up one message per attempt — and
    // every page turn, sort and post-write refetch is another attempt. The id
    // makes the newest failure replace the last, which is the one that is
    // still true. A mutation toast goes by itself, so it does not need one.
    ...(operation === 'fetch' ? { id: 'dataProvider-fetch' } : {}),
    timeout: operation === 'fetch' ? 0 : 4000,
    actions:
      operation === 'fetch'
        ? [{ label: grid.getTranslatedPhrase(PHRASE.DATA_PROVIDER_REFETCH), onClick: retry }]
        : [],
  });
}

/** The overlay a fetch puts up, when the grid has one. */
export function loadingOverlay(grid: Grid): Loading | undefined {
  return grid.getPlugin<Loading>('loading');
}
