import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { api } from '../../../../lib/api';
import { resolveMediaUrl } from '../../../../lib/media-url';

/** Uses the existing cookie/refresh API client; private images never become durable URLs. */
export function PortfolioImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const protectedResource =
    typeof src === 'string' && /^\/v1\/me\/provider\/portfolio\/[^/]+\/media$/.test(src);
  const [image, setImage] = useState<{ resource: string; url: string } | null>(null);
  useEffect(() => {
    if (!protectedResource || !src) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    void api
      .get<Blob>(src, { responseType: 'blob', signal: abort.signal })
      .then(({ data }) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(data);
        setImage({ resource: src, url: objectUrl });
      })
      .catch(() => {
        /* The labelled image placeholder remains available on read failure. */
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [protectedResource, src]);
  const url = protectedResource
    ? image?.resource === src
      ? image.url
      : undefined
    : (resolveMediaUrl(typeof src === 'string' ? src : null) ?? undefined);
  if (!url) return <span role="img" aria-label={alt || undefined} className={props.className} />;
  return <img {...props} src={url} alt={alt ?? ''} />;
}
