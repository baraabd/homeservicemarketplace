import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from '../telemetry/metrics.service';
import { findDeprecatedRoute, type DeprecatedRoute } from './deprecated-routes';

// Sprint 6 — advertises deprecated routes and counts their use.
//
// Middleware, not an interceptor: Nest runs guards before interceptors, so an
// interceptor would silently skip every 401/403 — precisely the responses a
// client stuck on an old route is most likely to be getting. Deprecation is a
// property of the resource, so the headers are unconditional.
//
// It changes NO behaviour: no rejection, no rate limit, no altered body. A
// deprecated route that starts failing is a removed route with extra steps,
// and the point of this sprint's convergence work is that nothing breaks while
// clients migrate.
//
// The counter is the load-bearing part. A route can be retired when
// `deprecated_route_requests_total{route="..."}` has been flat at zero across
// a full client-release cycle. Without it the choice is between deleting on a
// hopeful schedule and never deleting at all, and teams reliably pick the
// second.
@Injectable()
export class DeprecatedRouteMiddleware implements NestMiddleware {
  private readonly log = new Logger(DeprecatedRouteMiddleware.name);

  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // `originalUrl` carries the version prefix the registry is written
    // against; strip the query string, which is not part of the route.
    const path = (req.originalUrl || req.url).split('?')[0];
    const route = findDeprecatedRoute(path);
    if (!route) return next();

    this.applyHeaders(res, route);

    // Label with the registry PREFIX, never the concrete path: one label per
    // route family. Labelling by URL would put every bid id into the metric
    // and take the /metrics endpoint down on cardinality.
    this.metrics.deprecatedRouteRequestsTotal.inc({
      route: route.prefix,
      canonical: route.canonical,
      method: req.method,
    });

    // Debug, not warn. This fires on every call to a route that is expected to
    // still be receiving traffic; at warn it would drown the log and train
    // everyone to ignore it. The counter is the signal — this is for tracing a
    // specific caller once one shows up in it.
    this.log.debug({
      msg: 'deprecated_route.used',
      route: route.prefix,
      path,
      canonical: route.canonical,
      method: req.method,
      userAgent: req.header('user-agent') ?? null,
    });

    next();
  }

  private applyHeaders(res: Response, route: DeprecatedRoute): void {
    // draft-ietf-httpapi-deprecation-header: `true` means "deprecated,
    // effective date unspecified". The date that matters is Sunset.
    res.setHeader('Deprecation', 'true');

    // RFC 8594 requires an HTTP-date. An ISO-8601 string here is a malformed
    // header that tooling silently ignores, which would defeat the purpose —
    // so a bad value is logged loudly and the header is omitted rather than
    // emitted wrong.
    const sunset = new Date(route.sunset);
    if (Number.isNaN(sunset.getTime())) {
      this.log.error({
        msg: 'deprecated_route.invalid_sunset',
        route: route.prefix,
        sunset: route.sunset,
      });
    } else {
      res.setHeader('Sunset', sunset.toUTCString());
    }

    // RFC 8288. `successor-version` is the registered relation for "the
    // resource that replaces this one", so a client can follow it
    // programmatically instead of parsing prose.
    const link = `<${route.canonical}>; rel="successor-version"`;
    const existing = res.getHeader('Link');
    res.setHeader('Link', existing ? `${String(existing)}, ${link}` : link);

    res.setHeader('X-Deprecation-Reason', route.reason);
  }
}
