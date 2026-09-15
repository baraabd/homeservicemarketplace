import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { PortfolioMediaStream } from './portfolio-media.service';

export async function servePortfolioMedia(
  res: Response,
  media: PortfolioMediaStream,
): Promise<void> {
  // Moderation can change. Browser/CDN persistence must not bypass the next check.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Content-Disposition', 'inline');
  await pipeline(media.stream, res);
}
