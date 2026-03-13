# Refactoring Handoff Document

Generated: 2026-03-13
Branch: codex-process-001-300-tdd

> See also: [HANDOFF_PROCESS001-300.md](./HANDOFF_PROCESS001-300.md) for detailed
> architecture maps, test commands, and rollback procedures.

---

## Summary of Changes

This document records the refactoring completed in the Process 001-300 TDD cycle.

## Process 1: Baseline Establishment

- Baseline: 489 tests PASS, typecheck PASS
- Test commands verified and fixed for implementation sessions
- Rollback criteria: 489+ tests PASS + typecheck clean

## Process 2: Shared Contracts

- `src/shared/messages.ts`: Sectioned into Queue / Prefetch / Offscreen / Diagnostics groups
- `src/shared/utils/storage.ts`: Repository boundary comments added
- Circular dependency resolved: `types/index.ts` <-> `messages.ts`

## Process 10: Adapter Pattern Preparation

- contentResolver adapter interface documented in tests
- Test assertions decoupled from implementation details

## Process 50: Background Service Split

- `src/background/contentResolver.ts` extracted from `service.ts`
- `src/background/offscreenBridge.ts` extracted from `service.ts`
- `src/background/lifecycleSupervisor.ts` extracted from `service.ts`
- Tests: 489 -> 537 PASS (+48 new tests)

## Process 100: Popup/Options State Bridge

- `src/popup/hooks/usePopupBootstrap.ts` extracted from `App.tsx`
- `src/popup/hooks/useAddTabsActions.ts` extracted from `App.tsx`
- `src/popup/hooks/usePopupSettingsSync.ts` extracted from `App.tsx`
- `src/popup/hooks/tabQueue/useQueuePort.ts` extracted from `useTabQueue.ts`
- `src/popup/hooks/tabQueue/useQueueCommands.ts` extracted from `useTabQueue.ts`
- `src/popup/hooks/tabQueue/queueMessageReducer.ts` extracted from `useTabQueue.ts`
- `src/options/hooks/useOptionsData.ts` extracted from `OptionsApp.tsx`
- `src/options/hooks/useConnectionTest.ts` extracted from `OptionsApp.tsx`
- `src/options/services/settingsTransfer.ts` extracted from `OptionsApp.tsx`
- `App.tsx`: 471 -> ~340 lines (-131)
- `OptionsApp.tsx`: 500 -> ~280 lines (-220)
- Cross-layer import resolved: `options/OptionsApp.tsx` -> `popup/components/IgnoreListManager`
- Tests: 537 -> 556 PASS (+19 new tests)

---

## Architecture After Refactoring

### Background Layer

```
src/background/
├── service.ts               # BackgroundOrchestrator (972L, reduced)
├── contentResolver.ts       # NEW: Content resolution logic
├── offscreenBridge.ts       # NEW: Offscreen document bridge
├── lifecycleSupervisor.ts   # NEW: Install/startup lifecycle
├── runtimeCommandRouter.ts  # Runtime command routing
├── keepAliveController.ts   # Keep-alive heartbeat control
├── tabManager.ts            # Tab queue management (1111L)
├── aiPrefetcher.ts          # AI prefetch coordination
└── prefetch/
    ├── scheduler.ts         # Prefetch scheduling
    ├── worker.ts            # Processing pipeline
    ├── resultStore.ts       # Cache management
    └── cancelledWaitStore.ts # Cancelled-wait tracking
```

### Popup Layer

```
src/popup/
├── components/App.tsx       # Reduced: UI display only (~340L)
└── hooks/
    ├── useTabQueue.ts       # Entry point (86L)
    ├── usePopupBootstrap.ts # NEW: Initialization / data load
    ├── useAddTabsActions.ts # NEW: Add tab actions
    ├── usePopupSettingsSync.ts # NEW: storage.onChanged listener
    ├── usePrefetchStatus.ts # Prefetch status subscription
    └── tabQueue/
        ├── useQueuePort.ts        # NEW: Port lifecycle
        ├── useQueueCommands.ts    # NEW: Command dispatch
        └── queueMessageReducer.ts # NEW: Message parsing
```

### Options Layer

```
src/options/
├── OptionsApp.tsx           # Reduced: UI display only (~280L)
├── components/
│   └── IgnoreListManager.tsx  # Re-export shim (cross-layer boundary fix)
├── hooks/
│   ├── useOptionsData.ts    # NEW: Options data load
│   └── useConnectionTest.ts # NEW: OpenRouter connection test
└── services/
    └── settingsTransfer.ts  # NEW: Export/import pure functions
```

---

## File-to-Test Correspondence

| Source File | Primary Test File(s) |
|-------------|----------------------|
| `src/background/service.ts` | `backgroundService.test.ts`, `serviceContentResolverFallback.test.ts` |
| `src/background/contentResolver.ts` | `backgroundService.test.ts` |
| `src/background/offscreenBridge.ts` | `offscreenIntegration.test.ts` |
| `src/background/lifecycleSupervisor.ts` | `backgroundService.test.ts` |
| `src/background/runtimeCommandRouter.ts` | `runtimeCommandRouter.test.ts` |
| `src/background/tabManager.ts` | `tabManager.test.ts`, `tabManager.autoResume.test.ts` |
| `src/background/aiPrefetcher.ts` | `aiPrefetcher.test.ts` |
| `src/background/prefetch/scheduler.ts` | `prefetchScheduler.test.ts` |
| `src/popup/hooks/useTabQueue.ts` | `useTabQueue.test.tsx` |
| `src/popup/hooks/tabQueue/useQueuePort.ts` | `useQueuePort.test.ts` |
| `src/popup/hooks/usePopupBootstrap.ts` | `usePopupBootstrap.test.ts` |
| `src/options/hooks/useOptionsData.ts` | `useOptionsData.test.ts` |
| `src/shared/messages.ts` | `offscreenMessages.test.ts`, `types.structure.test.ts` |

---

## Test Results

| Phase | Tests PASS | Delta |
|-------|-----------|-------|
| Baseline (Process 1) | 489 | - |
| After Process 50 | 537 | +48 |
| After Process 100 | 556 | +19 |
| **Final** | **556** | **+67 total** |

---

## First 5 Files to Read (Next Session)

| Priority | File | Reason |
|----------|------|--------|
| 1 | `PLAN.md` | Process 1-300 design intent and completion status |
| 2 | `src/background/service.ts` | BackgroundOrchestrator — all command entry points |
| 3 | `src/popup/hooks/useTabQueue.ts` | Popup <-> Background port communication center |
| 4 | `src/background/prefetch/scheduler.ts` | AI prefetch scheduling logic |
| 5 | `src/shared/messages.ts` | All message types and payload definitions |

---

## Chrome / Firefox Manual Verification Points

### Chrome (Manifest V3)

1. **Continuous reading**: Service Worker does not sleep at 30s (OffscreenDocument heartbeat active)
2. **Popup reconnect**: After closing and reopening popup, state returns to `connected`
3. **Prefetch**: With 2+ tabs in queue, next tab status changes after reading starts
4. **Export/Import**: Settings export JSON does not contain `openRouterApiKey`

### Firefox (Manifest V2 / persistent script)

1. **Voice list init**: Correct voice selected immediately after install (waits up to 10s)
2. **Continuous reading**: `persistent: true` means no Service Worker timeout (no action needed)
3. **Popup**: Port reconnection works same as Chrome

---

## Known Remaining Items

| Risk | Location | Detail |
|------|----------|--------|
| prefetch diagnostics dual subscription | `App.tsx` + `service.ts` | `usePrefetchStatus` subscribes via port; `service` sends direct. Unification planned for next phase |
| `handleResetQueue` dead code | `App.tsx:129` | Defined but unused in JSX. Can be removed in next phase |
| `usePopupBootstrap` initError propagation | `App.tsx:50-55` | `initError` may persist after close button |
| `tabManager.ts` still 1111L | `background/tabManager.ts` | Major split opportunity for next cycle |
| prefetch diagnostics subscription path | multiple | Needs unification (deferred from this cycle) |
