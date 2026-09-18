import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProviderButton } from './primitives';

// Vite rewrites static new-URL CSS references into browser asset URLs. Read
// the source file through Node paths, from either workspace invocation root.
const themePath = [
  resolve(process.cwd(), 'src/styles/theme.css'),
  resolve(process.cwd(), 'apps/web/src/styles/theme.css'),
].find((path) => existsSync(path));
if (!themePath) throw new Error('Cannot locate the provider theme source');
const css = readFileSync(themePath, 'utf8');

afterEach(cleanup);

function token(theme: 'light' | 'dark', name: string): string {
  const selector = theme === 'dark' ? /\.dark\s*\{([\s\S]*?)\n\}/ : /:root\s*\{([\s\S]*?)\n\}/;
  const block = css.match(selector)?.[1];
  const value = block?.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})\\s*;`, 'i'))?.[1];
  if (!value) throw new Error(`Missing ${theme} token ${name}`);
  return value;
}

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Provider action foregrounds', () => {
  it.each(['primary', 'danger'] as const)('%s uses the semantic dark foreground', (tone) => {
    render(<ProviderButton tone={tone}>Action</ProviderButton>);
    const classes = screen.getByRole('button', { name: 'Action' }).className.split(' ');
    expect(classes).toContain('text-white');
    expect(classes).toContain('dark:text-pv-bg');
    expect(classes).toContain('dark:disabled:text-pv-muted');
  });

  it.each(['light', 'dark'] as const)('%s primary and hover fills support normal text', (theme) => {
    const foreground = theme === 'dark' ? token(theme, 'pv-bg') : '#ffffff';
    for (const fill of ['pv-accent', 'pv-accent-hover', 'pv-danger']) {
      expect(contrast(foreground, token(theme, fill)), `${theme}: ${fill}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('detects the original white-on-light-blue regression', () => {
    expect(contrast('#ffffff', token('dark', 'pv-accent'))).toBeLessThan(4.5);
  });
});
