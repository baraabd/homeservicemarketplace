import { expect, type Page } from '@playwright/test';
import type { AdminProviderReviewTaskId } from '@homeservicemarketplace/contracts';

/** Drive the real control; never reveal hidden sections with injected styles or DOM writes. */
export async function openReviewTask(page: Page, task: AdminProviderReviewTaskId) {
  const trigger = page.getByTestId(`review-tab-${task}`);
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-selected', 'true');
  const workspace = page.getByTestId('admin-provider-review-workspace');
  await expect(workspace.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByTestId(`review-panel-${task}`)).toBeVisible();
  await expect(page.getByTestId(`review-section-${task}`)).toBeVisible();
}
