import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

let checkpoint = 'not-started';
export const offlineLogoutCheckpoint = () => checkpoint;

/** Real UI and browser network isolation; no successful HTTP-response mocks. */
export async function acceptOfflineLogout({ context, page, peer, web, api, prepareLogout }) {
  const step = (name) => { checkpoint = name; console.log(`R04 logout checkpoint: ${name}`); };
  step('peer-authenticated');
  await peer.goto(`${web}/home/profile`);
  // A route existing in the address bar does not prove its /me query finished.
  // Hidden drawers must not create a second accessible Settings control.
  await expect(peer.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(peer.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(peer.getByTestId('notification-drawer')).toHaveAttribute('inert', '');
  const hiddenSettings = peer.getByTestId('notification-drawer').getByText('Settings', { exact: true });
  await hiddenSettings.evaluate((button) => button.focus());
  await expect(hiddenSettings).not.toBeFocused();
  step('open-confirmation');
  await prepareLogout(page);
  await expect(page.getByText('Are you sure you want to sign out?', { exact: true })).toBeVisible();
  step('offline-click');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).last().click();
  step('local-notice');
  await expect(page.getByTestId('auth-logout-notice')).toContainText('not confirmed');
  step('peer-logged-out');
  await expect(peer).toHaveURL(/\/login$/u);
  step('online-reload');
  await context.setOffline(false);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByTestId('auth-logout-notice')).toContainText('not confirmed');
  step('retry-server-logout');
  const response = page.waitForResponse((r) => r.url() === `${api}/v1/auth/logout` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Retry server sign-out', exact: true }).click();
  assert.equal((await response).status(), 204, 'The real server must acknowledge logout');
  step('confirmed-notice-cleared');
  await expect(page.getByTestId('auth-logout-notice')).toHaveCount(0);
  step('complete');
}
