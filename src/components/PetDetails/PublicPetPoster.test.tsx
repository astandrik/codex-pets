// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicPetPoster } from './PublicPetPoster';

afterEach(() => vi.restoreAllMocks());

it('shows a stable fallback when the server-rendered image failed before hydration', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
  const props = { slug: 'boba', displayName: 'Boba', description: 'A helpful pet' };
  const host = document.createElement('div');
  host.innerHTML = renderToString(<PublicPetPoster {...props} />);
  const root = hydrateRoot(host, <PublicPetPoster {...props} />);
  try {
    await act(async () => {});
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Preview unavailable');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.public-pet-poster')).not.toBeNull();
    width.mockReturnValue(192);
    await act(async () => root.render(<PublicPetPoster {...props} slug="another" />));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/pets/another/preview.webp');
    expect(host.querySelector('[role="status"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
