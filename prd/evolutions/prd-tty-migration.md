/**
 * PRD for migrating the custom TTY rendering layer to standard npm libraries.
 * Covers menus, prompts, box drawing, text wrapping, gradient banner, and progress bars.
 *
 * @module prd/evolutions/prd-tty-migration
 */
# PRD: Migration du moteur TTY custom vers des librairies standard

## Overview

- **Problem:** Le projet embarque ~2 500 lignes de code UI custom (`src/ui/`) qui gère les menus interactifs, le box-drawing, le word-wrap ANSI-aware, les barres de progression, les prompts, et le gradient banner. Ce code est fonctionnel mais couvre des cas que des librairies matures gèrent mieux (compatibilité Windows Terminal, CI sans TTY, terminals exotiques, accessibilité).
- **Solution:** Remplacer progressivement les modules custom par des librairies npm spécialisées et éprouvées, en conservant l'identité visuelle du projet (gradient, guru meditation, phrases fun).
- **Success Metrics:**
  - Réduction de >=60% des lignes de code dans `src/ui/` (de ~2 500 à ~1 000 lignes max)
  - Zéro régression visuelle sur macOS, Linux et Windows Terminal
  - Tous les tests existants (menu-flow, menu-settings, menu-rendering, share-prompt, submitter-prompt) passent au vert
  - Aucun nouveau bug TTY sur les issues GitHub pendant 30 jours post-release

## Inventory — Current State

| File | Lines | Role | Custom complexity |
|------|------:|------|-------------------|
| `menu.ts` | 1 054 | Menu interactif (flèches, numpad, raw mode, fallback texte), boucle principale | Very High |
| `verdict.ts` | 256 | Box-drawing, word-wrap ANSI-aware, barres de progression, sections colorées | High |
| `submitter-prompt.ts` | 196 | Prompt nickname/email avec validation, gestion raw mode | Medium |
| `share-prompt.ts` | 186 | Menu share post-benchmark (y/n/a, flèches, raccourcis) | High |
| `progress.ts` | 155 | Wrapper ora + rotation de phrases humoristiques | Medium |
| `guru-meditation.ts` | 125 | Easter egg Amiga (animation blink, box custom) | Medium |
| `banner.ts` | 81 | Logo gradient RGB multi-stops, interpolation custom | Medium |
| `thinking-prompt.ts` | 41 | Prompt y/N simple | Low |
| `results-table.ts` | 386 | Tables cli-table3 + coloring conditionnel, barres compactes | Medium |
| `terminal.ts` | 11 | Unicode detection, stripAnsi | Trivial |
| `score-color.ts` | 10 | Score → couleur chalk | Trivial |
| **Total** | **2 501** | | |

## Target Libraries

| Library | Version | Weekly downloads | Purpose | Replaces |
|---------|---------|-----------------|---------|----------|
| **@clack/prompts** | ^0.10 | ~500k | Select menus, confirm, text input, multiselect | `menu.ts` (selectOption, selectWithArrows, selectWithPrompt), `share-prompt.ts`, `submitter-prompt.ts`, `thinking-prompt.ts` |
| **wrap-ansi** | ^9 | ~70M | Word-wrap preserving ANSI escape codes | `verdict.ts` (wrapText, visibleLength) |
| **gradient-string** | ^3 | ~2M | Multi-stop gradient text | `banner.ts` (interpolateColor, gradientLine) |
| **boxen** | ^8 | ~20M | Box drawing with borders, padding, colors | `verdict.ts` (sectionStart, sectionEnd, sectionText, BOX_* constants) |
| **string-width** | ^7 | ~90M | Accurate visible string width (CJK, emoji, ANSI-safe) | `verdict.ts` (visibleLength), `results-table.ts` (compactBar width) |

### Libraries NOT replaced (kept as-is)

| Library | Reason |
|---------|--------|
| **chalk** | Already standard, used everywhere — no change |
| **ora** | Already standard for spinners — keep custom phrase rotation wrapper |
| **cli-table3** | Already standard for tables — keep custom coloring on top |
| **commander** | CLI parsing — not related to TTY rendering |

### Code NOT migrated (intentionally custom)

| File | Reason |
|------|--------|
| `guru-meditation.ts` | Easter egg with Amiga blink animation — unique personality, no lib equivalent |
| `progress.ts` | Phrase rotation is a brand feature; ora wrapper is thin (~40 lines of actual logic) |
| `results-table.ts` | Conditional coloring on cli-table3 is domain logic, not generic rendering |
| `score-color.ts` | 10 lines, trivial lookup |
| `terminal.ts` | 11 lines, trivial detection (but may be replaced by `string-width` import) |

## Migration Plan

### Phase 1 — Drop-in replacements (low risk, high value)

**P1.1: `banner.ts` → gradient-string**

| Aspect | Detail |
|--------|--------|
| Scope | Replace `interpolateColor()`, `gradientLine()` (~40 lines) |
| Target | `gradient-string` with custom multi-stop config matching current cyan→magenta palette |
| Risk | Low — purely cosmetic, no state management |
| Lines saved | ~40 |
| Tests impacted | None (no unit tests for banner) |

```typescript
// Before (custom)
import { interpolateColor, gradientLine } from "./banner-utils.js";
const colored = gradientLine(line);

// After
import gradient from "gradient-string";
const metrillmGradient = gradient(["cyan", "#64B4FF", "#3264FF", "#5A3CE6", "#C832C8"]);
const colored = metrillmGradient(line);
```

**P1.2: `verdict.ts` wrapText → wrap-ansi + string-width**

| Aspect | Detail |
|--------|--------|
| Scope | Replace `wrapText()`, `visibleLength()` (~30 lines) |
| Target | `wrap-ansi` for wrapping, `string-width` for width calculation |
| Risk | Low — drop-in replacement, same behavior |
| Lines saved | ~30 |
| Tests impacted | None (no unit tests for verdict rendering) |

```typescript
// Before (custom)
const lines = wrapText(text, maxWidth);
const width = visibleLength(str);

// After
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
const lines = wrapAnsi(text, maxWidth, { hard: true }).split("\n");
const width = stringWidth(str);
```

**P1.3: `verdict.ts` box-drawing → boxen (partial)**

| Aspect | Detail |
|--------|--------|
| Scope | Evaluate replacing `sectionStart/End/Text` with boxen |
| Risk | Medium — the verdict uses 3 sections with different border colors, which boxen supports via `borderColor`. However, boxen renders a complete box at once, while current code streams section-by-section. **May require building content string first, then rendering one boxen per section.** |
| Decision point | If boxen's API doesn't support multi-section colored borders natively, keep custom box-drawing but use `string-width` + `wrap-ansi` for the content filling. This still saves ~30 lines. |
| Lines saved | 30-60 depending on approach |

### Phase 2 — Menu & prompt migration (medium risk, highest value)

**P2.1: `thinking-prompt.ts` → @clack/prompts confirm**

| Aspect | Detail |
|--------|--------|
| Scope | Replace entire file (41 lines) with one `confirm()` call |
| Risk | Very low — simplest prompt, no state |
| Lines saved | ~35 |
| Tests impacted | None |

```typescript
// Before (custom readline)
export async function promptThinkingMode(): Promise<boolean> { /* 40 lines */ }

// After
import { confirm } from "@clack/prompts";
export async function promptThinkingMode(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const result = await confirm({ message: "Enable thinking mode?" });
  return result === true;
}
```

**P2.2: `submitter-prompt.ts` → @clack/prompts text**

| Aspect | Detail |
|--------|--------|
| Scope | Replace `askLine()` and validation loops (~100 lines) with `text()` + `validate` option |
| Risk | Low — clack's `text()` supports inline validation |
| Lines saved | ~80 |
| Tests impacted | `submitter-prompt.test.ts` — needs adapter for DI pattern |

```typescript
// After
import { text } from "@clack/prompts";
const nickname = await text({
  message: "Nickname",
  placeholder: defaults.nickname,
  validate: (v) => !isValidNickname(v) ? "Between 2 and 40 characters" : undefined,
});
```

**P2.3: `share-prompt.ts` → @clack/prompts select**

| Aspect | Detail |
|--------|--------|
| Scope | Replace custom arrow menu + shortcuts (~120 lines) with `select()` |
| Risk | Medium — current implementation has numpad shortcuts (1/2/3, y/n/a) that clack doesn't natively support. Options: (a) accept clack's standard UX, (b) wrap clack with a keypress listener for shortcuts. |
| Decision | Accept clack's standard navigation (arrows + enter). The y/n/a shortcuts are nice-to-have but not critical — users already have arrows. |
| Lines saved | ~120 |
| Tests impacted | `share-prompt.test.ts` — needs mock adapter |

**P2.4: `menu.ts` selectOption → @clack/prompts select**

| Aspect | Detail |
|--------|--------|
| Scope | Replace `selectOption()`, `selectWithArrows()`, `selectWithPrompt()`, `renderMenu()`, `waitForContinue()` (~270 lines of generic menu infrastructure) |
| Risk | **Highest** — most complex piece. `selectOption` is called from 10+ places with hints, subtitles, and escape behavior. |
| Constraints | (1) clack `select` supports `options[].hint` natively. (2) Escape/cancel returns `Symbol` in clack — needs `isCancel()` check. (3) `waitForContinue()` has no clack equivalent — keep a minimal custom version or use a dummy `confirm()`. |
| Lines saved | ~270 |
| Tests impacted | `menu-flow.test.ts`, `menu-settings.test.ts`, `menu-rendering.test.ts` — significant refactor needed |

```typescript
// After
import { select, isCancel } from "@clack/prompts";

async function selectOption<T>(title: string, options: MenuOption<T>[], config: SelectOptions = {}): Promise<T | null> {
  const result = await select({
    message: title,
    options: options.map(o => ({ value: o.value, label: o.label, hint: o.hint })),
  });
  if (isCancel(result)) return null;
  return result;
}
```

### Phase 3 — Cleanup & polish

**P3.1: Remove dead code**

- Delete `terminal.ts` if `string-width` replaces all `stripAnsi`/`visibleLength` usage
- Remove unused ANSI escape constants (`SAVE_CURSOR_POSITION`, etc.) from `menu.ts`
- Remove `isEnterKey()` helper duplicated in menu.ts and share-prompt.ts

**P3.2: Unify DI pattern for tests**

Current tests use dependency injection (`deps` parameter) to mock readline interactions. With clack, the DI pattern changes:
- Option A: Mock `@clack/prompts` module via vitest `vi.mock()`
- Option B: Keep the `deps` injection pattern by wrapping clack calls behind an interface

**Recommendation:** Option A (vi.mock) is simpler and more standard with vitest.

**P3.3: Update package.json**

```json
{
  "dependencies": {
    "@clack/prompts": "^0.10.0",
    "boxen": "^8.0.1",
    "gradient-string": "^3.0.0",
    "string-width": "^7.2.0",
    "wrap-ansi": "^9.0.0"
  }
}
```

All 5 packages are ESM-only, compatible with the project's `"type": "module"` setup.

## Impact Assessment

### Lines of code

| Phase | Before | After (est.) | Reduction |
|-------|--------|-------------|-----------|
| P1: Drop-in | 337 (banner + verdict) | ~237 | -100 |
| P2: Menus & prompts | 1 477 (menu + share + submitter + thinking) | ~550 | -927 |
| P3: Cleanup | — | -50 | -50 |
| **Total** | **2 501** | **~1 400** | **-1 100 (~44%)** |

Note: `menu.ts` restera le fichier le plus gros car il contient la logique métier du menu principal (786 lignes de flow logic: `runInteractiveMenu`, `runSettingsMenu`, `choosePostBenchmarkAction`, etc.) qui n'est PAS du rendu TTY et ne doit PAS être migrée. Seule l'infrastructure de sélection (~270 lignes) est remplacée.

### Dependencies

| Metric | Before | After |
|--------|--------|-------|
| Runtime deps | 7 | 12 (+5) |
| Bundle size impact | — | +~50 KB (all lightweight) |
| Install time impact | — | Negligible (all pure JS, no native) |

### Test files impacted

| Test file | Impact | Effort |
|-----------|--------|--------|
| `menu-flow.test.ts` | Refactor DI → vi.mock | Medium |
| `menu-settings.test.ts` | Refactor DI → vi.mock | Medium |
| `menu-rendering.test.ts` | May be deletable (rendering is now library-owned) | Low |
| `share-prompt.test.ts` | Refactor DI → vi.mock | Medium |
| `submitter-prompt.test.ts` | Refactor DI → vi.mock | Medium |
| `bench-share-policy.test.ts` | Minimal — tests policy logic, not rendering | Low |

### Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| @clack/prompts doesn't support a needed UX pattern | Low | Medium | Keep a thin custom fallback; clack is actively maintained |
| boxen can't handle multi-section colored borders | Medium | Low | Keep custom box-drawing, still use wrap-ansi/string-width |
| Test refactoring takes longer than expected | Medium | Medium | Phase 2 tests can be temporarily skipped during migration |
| Visual regression on Windows | Low | Medium | Test manually on Windows Terminal + cmd.exe before release |
| Bundle size grows too much | Very Low | Low | All libs are small; tree-shaking via tsup handles the rest |

## Out of Scope

- **guru-meditation.ts** — Easter egg, stays custom
- **progress.ts phrase rotation** — Brand personality, stays custom
- **results-table.ts conditional coloring** — Domain logic on top of cli-table3, stays custom
- **CLI command logic** (bench.ts, list.ts, etc.) — Not UI rendering
- **MCP server** — Separate package, no TTY rendering
- **Ink/React-based TUI rewrite** — Over-engineering for a CLI tool; clack is sufficient

## Execution Order

```
P1.1 banner.ts → gradient-string          ← Start here (safest, 1h)
P1.2 verdict.ts → wrap-ansi + string-width ← Next (safe, 1h)
P1.3 verdict.ts → boxen (evaluate)         ← Spike, may skip (2h)
P2.1 thinking-prompt.ts → clack confirm    ← Quick win (30min)
P2.2 submitter-prompt.ts → clack text      ← Medium (2h)
P2.3 share-prompt.ts → clack select        ← Medium (2h)
P2.4 menu.ts selectOption → clack select   ← Biggest piece (4h)
P3.1 Dead code cleanup                     ← After all phases (1h)
P3.2 Test refactoring                      ← After all phases (3h)
P3.3 package.json + CI verify              ← Final step (30min)
```

**Estimated total effort:** ~17h of focused dev time.

## Rollback Plan

Each phase is independent and can be reverted individually via git. The migration follows a strangler fig pattern: new code wraps old interfaces, so partial migration is always functional.

## See Also

- [Multi-backend architecture](../docs/multi-backend.md)
- [@clack/prompts documentation](https://github.com/bombshell-dev/clack)
- [boxen documentation](https://github.com/sindresorhus/boxen)
- [gradient-string documentation](https://github.com/bokub/gradient-string)
