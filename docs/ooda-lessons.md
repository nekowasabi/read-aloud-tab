# OODA Cycle Lessons - Process 001-300

Date: 2026-03-13
Mission: TDD Refactoring Process 001-300
Branch: codex-process-001-300-tdd

---

## Cycle C1 Lessons

### Observe Phase

- `service.ts` (1233L) and `tabManager.ts` (1111L) were identified as HOTSPOT files
- `runtimeCommandRouter.ts` was already extracted before the cycle started (reduced scope)
- 44 uncompleted tasks identified in `PLAN.md` at cycle start
- Circular dependency found: `types/index.ts` <-> `messages.ts`
- Cross-layer import risk detected: `options/OptionsApp.tsx` -> `popup/components/IgnoreListManager`

### Orient Phase

- Complexity score: 85/100 (CRITICAL)
- Dependency order enforced: G1 (shared) -> G2 (background) -> G3 (popup/options) -> G4 (docs)
- Adapter Shim pattern selected for cross-layer import resolution
- DI pattern (Factory with DI) chosen as primary abstraction for extracted modules

### Decide Phase

- 16 subtasks decomposed across 4 groups (G1-G4)
- File ownership assigned: executor-1 (shared/docs), executor-2 (background/popup)
- TDD Red/Green/Refactor strictly enforced per process step
- Rollback threshold: any reduction below 489 PASS triggers immediate revert

### Act Phase

- TDD Red/Green/Refactor cycle followed for every process
- Adapter Shim pattern applied to resolve cross-layer import without breaking existing tests
- `service.ts` split into `contentResolver.ts`, `offscreenBridge.ts`, `lifecycleSupervisor.ts`
- `useTabQueue.ts` split into `useQueuePort.ts`, `useQueueCommands.ts`, `queueMessageReducer.ts`
- All 489 existing tests remained green throughout refactoring

---

## Key Patterns Learned

### Pattern 1: Adapter Shim for Cross-Layer Imports

**Problem**: `options/OptionsApp.tsx` imported from `popup/components/IgnoreListManager`
**Solution**: Create `options/components/IgnoreListManager.tsx` as a re-export shim pointing to the popup component
**Principle**: Never break existing functionality while enforcing layer boundaries. A shim is preferable to a rushed move that breaks consumers.

### Pattern 2: Section Comments Before Full Split

**Problem**: `messages.ts` needed splitting but the full split risked circular dependencies
**Solution**: Add JSDoc section comments (Queue / Prefetch / Offscreen / Diagnostics) first, plan split targets, execute split in a later process
**Principle**: Prepare boundaries incrementally before actual extraction. Naming intent before moving code reduces risk.

### Pattern 3: Placeholder Tests for TDD Red Phase

**Problem**: Extracting not-yet-existing modules needs failing tests before any implementation
**Solution**: Create placeholder tests referencing the new module path; tests fail because the file does not exist yet
**Principle**: Tests define intent; implementation follows tests. The Red phase must be genuinely Red.

### Pattern 4: Blacklist Over Whitelist for Status Filtering

**Problem**: `handleStatusUpdate()` whitelist `['reading', 'paused']` caused prefetch to not trigger on `idle`
**Solution**: Switch to blacklist — skip only `'error'`, allow all other statuses through
**Principle**: Whitelist-based status filters break silently when new statuses are added. Blacklist-based filters are more resilient to extension.

### Pattern 5: Dynamic Getter for Config Override

**Problem**: `maxPrefetchAhead` needed to change at runtime based on `summaryWaitMode` without breaking the stored config value
**Solution**: Implement as a getter that returns an override value when `waitMode === 'wait'`, otherwise returns the stored `_configuredMaxPrefetchAhead`
**Principle**: Do not mutate stored config to express runtime state. Use getters to layer runtime overrides on top of persisted values.

---

## Technical Lessons

### T1: isPrefetchComplete() Semantics Risk

`AiPrefetcher.isPrefetchComplete()` returns `true` when no entry exists in the status map. This is intentional for the case where AI settings are disabled, but creates a risk of treating "not started" as "done" in new code paths. Always check whether an entry exists before trusting the return value in new consumers.

### T2: summaryWaitMode Two-Level Timeout

`waitMode === 'wait'` requires a 120s timeout; `waitMode === 'skip'` uses 30s (argument default). Keep these two timeout values as named constants and separate them explicitly in the call site rather than using a single conditional inline.

### T3: Fallback Condition Semantic Drift

When `waitResult === 'failed'`, the `wait` mode still wants on-demand summarization as a fallback (user intent: try as hard as possible). The `skip` mode does not. Ensure the fallback branch in `resolveContent()` is conditioned on `waitMode`, not on `waitResult` alone.

### T4: Storage Change Propagation Pattern

`chrome.storage.onChanged` listener in `service.ts` must call `PrefetchScheduler.setSummaryWaitMode()` immediately to avoid a window where the scheduler uses stale config after a user settings change.

---

## Process Lessons

### P1: Hotspot Files Need Early Splitting

Files over 1000L with mixed responsibilities (`service.ts`, `tabManager.ts`) are the primary source of merge conflicts and test fragility. Identify and split them at the start of a cycle, not after feature work is done.

### P2: Test Count as a Leading Indicator

Test count growth (+67 in this cycle: 489 -> 556) is a proxy for responsibility isolation. Each extracted module adds tests; a module with zero new tests after extraction was likely not truly isolated.

### P3: Worker Process Leak Warning is Non-Blocking

The Jest warning "A worker process has failed to exit gracefully" appears after `ttsEngine.test.ts` due to active timers. This does not indicate test failure. Add `.unref()` to timer handles in the TTS engine to eliminate the warning in a future cleanup pass.

### P4: Commit Granularity

One process = one commit. This makes `git bisect` effective when a regression appears. Committing multiple processes in one commit obscures which change introduced a regression.

---

## Antipatterns Identified

| Antipattern | Location | Impact | Mitigation |
|-------------|----------|--------|------------|
| Dual subscription path for diagnostics | `App.tsx` + `service.ts` | Potential duplicate state updates | Unify to single port-based path (next cycle) |
| Dead code exported from App.tsx | `handleResetQueue` at line 129 | Cognitive noise, unused bundle weight | Remove in cleanup pass |
| initError state copied in useEffect | `App.tsx:50-55` | Error state may persist after UI dismissal | Lift error state or clear on dismiss |
| tabManager.ts 1111L monolith | `background/tabManager.ts` | High change friction, test coupling | Plan split: TTS control vs queue management |

---

## Test Command Reference

```bash
# Scoped test runs
npm run test -- --testPathPattern="popup"       # Popup layer (15 suites)
npm run test -- --testPathPattern="options"     # Options layer
npm run test -- --testPathPattern="background"  # Background layer
npm run test -- --testPathPattern="prefetch"    # Prefetch subsystem
npm run test -- --testPathPattern="useTabQueue" # useTabQueue only
npm run test -- --testPathPattern="useQueuePort" # Port lifecycle only

# Full suite (556 tests)
npm run test

# Type check (must be zero errors)
npm run typecheck
```

### Hotspot Rerun Map

| When you change... | Also run... |
|--------------------|-------------|
| `src/popup/hooks/tabQueue/useQueuePort.ts` | `useQueuePort.test.ts`, `useTabQueue.test.tsx` |
| `src/popup/components/App.tsx` | `App.test.tsx` |
| `src/options/OptionsApp.tsx` | `OptionsApp.test.tsx` |
| `src/background/prefetch/scheduler.ts` | `prefetchScheduler.test.ts` |
| `src/shared/messages.ts` | `offscreenMessages.test.ts`, `types.test.ts` |
| `src/background/service.ts` | `backgroundService.test.ts`, `serviceContentResolverFallback.test.ts` |

---

## Rollback Commands

```bash
# Check current position
git log --oneline -5

# Roll back to Process 50 completion (before Process 100)
git checkout 3899278

# Roll back to main (before this cycle)
git checkout main
```

---

## Recommendations for Next Cycle

1. **`tabManager.ts` (1111L)** — highest-priority split target; separate TTS control from queue state management
2. **`service.ts` (~972L)** — further reduction possible; command dispatch table can be extracted
3. **prefetch diagnostics** — unify dual subscription path (port-based vs direct send) into single source of truth
4. **barrel exports** — add `index.ts` for `background/prefetch/` directory to reduce import path verbosity
5. **timer `.unref()`** — eliminate Jest worker leak warning in `ttsEngine.test.ts`
6. **`handleResetQueue` dead code** — safe to remove from `App.tsx`
