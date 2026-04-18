// Global Express Request augmentations used by IAM.
// @types/express defines Request in the Express global namespace (and
// re-exports from express-serve-static-core). Augmenting the global
// namespace propagates to every `import { Request } from 'express'`.

import type { AuthTransport } from './authenticated-user';

declare global {
  namespace Express {
    interface Request {
      authTransport?: AuthTransport;
    }
  }
}

export {};
