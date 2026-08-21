import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RequestMediaGallery } from './RequestMediaGallery';

describe('RequestMediaGallery', () => {
  it('renders nothing when there is no media', () => {
    const { container } = render(<RequestMediaGallery urls={[]} testId="gallery" />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<RequestMediaGallery urls={null} testId="gallery" />);
    expect(c2.firstChild).toBeNull();
  });

  it('renders one image thumbnail for a single absolute URL', () => {
    render(<RequestMediaGallery urls={['https://cdn.example.com/a.jpg']} testId="gallery" />);
    const imgs = screen.getAllByTestId('media-thumb-img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'https://cdn.example.com/a.jpg');
  });

  it('renders a thumbnail per URL for multiple images', () => {
    render(
      <RequestMediaGallery
        urls={[
          'https://cdn.example.com/a.jpg',
          'https://cdn.example.com/b.jpg',
          'https://cdn.example.com/c.jpg',
        ]}
        testId="gallery"
      />,
    );
    expect(screen.getAllByTestId('media-thumb-img')).toHaveLength(3);
  });

  it('renders a placeholder (not a broken image) when an image fails to load', () => {
    render(<RequestMediaGallery urls={['https://cdn.example.com/missing.jpg']} testId="gallery" />);
    const img = screen.getByTestId('media-thumb-img');
    fireEvent.error(img);
    expect(screen.queryByTestId('media-thumb-img')).toBeNull();
    expect(screen.getByTestId('media-thumb-fallback')).toBeInTheDocument();
  });

  it('renders a <video> element for video extensions', () => {
    render(<RequestMediaGallery urls={['https://cdn.example.com/clip.mp4']} testId="gallery" />);
    expect(screen.getByTestId('media-thumb-video')).toBeInTheDocument();
  });

  it('filters out empty/invalid URLs', () => {
    render(
      <RequestMediaGallery urls={['', '   ', 'https://cdn.example.com/a.jpg']} testId="gallery" />,
    );
    expect(screen.getAllByTestId('media-thumb-img')).toHaveLength(1);
  });
});
