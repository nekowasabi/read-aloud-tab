/**
 * IgnoreListManager.tsx (options layer re-export)
 * Process 100: options -> popup cross-layer import resolution.
 *
 * The canonical implementation lives in popup/components/IgnoreListManager.tsx
 * which depends only on shared utilities and shared UI primitives.
 * This re-export removes the cross-layer dependency from OptionsApp.tsx.
 */
export { default } from '../../popup/components/IgnoreListManager';
