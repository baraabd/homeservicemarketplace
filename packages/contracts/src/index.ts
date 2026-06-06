export * from './iam';
// Explicit named re-export (not `export * from './media'`): the runtime
// `MAX_REQUEST_MEDIA_ITEMS` const must reach the web bundle, and tsc
// compiles an explicit re-export to a statically-analyzable
// `Object.defineProperty(exports, ...)` that Rollup/Vite can tree-shake
// — a nested `export *` barrel emits `__exportStar`, whose named
// members Rollup cannot detect, breaking the production web build.
export { MAX_REQUEST_MEDIA_ITEMS } from './media/constants';
export * from './seeker';
export * from './provider';
export * from './admin';
export * from './realtime';
