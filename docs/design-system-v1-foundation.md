# P&M Soft Neumorphism — Sprint 1A foundation

Product expression: **Molded Operations Console**. Depth must have meaning.

## Scope and adoption

`src/design-system-v1.css` is imported once by `src/styles.css`. Every rule is
explicitly scoped to `.pm-design-v1`. No existing application page or layout opts
in during Sprint 1A. No global theme variable is overwritten. Tokens use the
`--pm-v1-*` namespace; existing Navy and semantic state meanings remain intact.

A future, separately reviewed page adoption may put `.pm-design-v1` on an
ancestor of its shared primitives. Adding the class to an individual Button does
not scope that Button: use a parent. Do not add it to the application root.
Canvas application is also explicit: the scope declares tokens and does not set
an ancestor's background, typography, display, dimensions or positioning.

Example for an isolated fixture (not a new application route):

```tsx
<div className="pm-design-v1" style={{ background: 'var(--pm-v1-canvas)' }}>
  <Button>확인</Button>
  <Button variant="secondary">취소</Button>
  <Button variant="danger">반려견 정보 삭제</Button>
  <Input aria-label="반려견 이름" />
</div>
```

## Tokens and meaning

| Token family | Meaning |
| --- | --- |
| canvas / surface / raised / tray | #DDE5ED / #E8EEF4 / #EDF2F7 / #D4DFE9 |
| ink / muted | #22394E / #506477 |
| navy | Existing `--color-primary`, fallback #274C77 |
| blue / green / orange | Existing info / success / warning aliases |
| danger | Muted burgundy text, pale danger surface, visible border |
| depth-raised | Raised object; interactive hover |
| depth-key | Shallow raised action |
| depth-inset / depth-slot | Structural input well / passive recessed cue |
| depth-pressed | Navy pressed or `aria-pressed=true` key |
| depth-overlay | Modal elevation, without changing its layout |
| radius-1 … radius-5 | 6 / 8 / 16 / 24 / 24px |
| space-xs / s / m / l / xl | 4 / 8 / 12 / 16 / 24px |
| display-kpi / page-title / section-title | Semantic typography aliases |
| object-primary / object-secondary / body / metadata / micro-label | Semantic typography aliases |

Semantic Badge label/tone mapping is not restyled or reclassified. Only its
radius and shallow depth change inside the scope. Tokens are available for later
adoption; there is no automatic page-wide typography replacement.

## Public API and behavior preservation

`ui.tsx` differs only by additional class-name tokens. Removing the added
`pm-v1-* ` tokens reproduces the original file byte-for-byte.

| Component | Preserved contract | Opt-in presentation |
| --- | --- | --- |
| Button | Native button props, primary/secondary/danger/ghost, caller className, event forwarding, disabled | Key surface; danger secondary; flat disabled; 2px focus outline |
| Input | Native props, forwardRef, value/change/validation/readonly/disabled | Recessed well; explicit focus and invalid rim |
| SearchBox | Input props, inputRef, onClear, existing rAF focus | Inherited Input style; clear control focus outline |
| Select / Textarea | Native props and keyboard/value/change handling | Recessed well |
| Modal | open/title/description/onClose/size/wide/extraWide/resetKey | Existing panel/header selectors, material and shadow only |
| Badge / StatusBadge | children, tone, status labels and mappings | Recessed chip; color and labels unchanged |
| FilterToolbar | children/className; existing Card/grid layout | Passive recessed surface |
| Pagination | page/totalPages/totalLabel/onPageChange, boundary disable | Existing buttons inherit key styles |
| PageHeader | title/description/action and existing responsive layout | Title ink and semantic type |
| Table | scrollResetKey, ref/effect, table props | Untouched |
| ResponsiveActionGroup | Existing breakpoint, overflow and handlers | Untouched; nested Buttons inherit only when scoped |
| ModalActions / ConfirmModal | Existing footer, processing, onConfirm/onClose | Untouched; nested Buttons inherit only when scoped |

The current shared Modal renders inline, **not through a portal**. Initial focus,
Tab containment, Escape, backdrop handling, opener restoration and scroll reset
remain exactly as implemented. This sprint does not add a portal or body-lock
behavior. Any future portal host must receive an explicit, separately reviewed
scope; CSS inheritance cannot cross an unrelated DOM root.

No state, hooks, query, RPC, permission, validation, command, routing, generation,
interaction lock, timer, measurement, event handler, dependency or animation was
added to application behavior. Existing transition/transform rules remain.

## Verification and limits

- Shared contracts: button forwarding/disabled, input ref and validation,
  select/textarea changes, search clear focus, Modal Escape/backdrop/restoration,
  ConfirmModal processing lock, pagination and status semantics.
- Every added CSS selector must be scoped; no global theme or keyframe rule.
- Real shared components rendered in an external local fixture at 390, 767,
  768 and 1440px. No Production route or in-repository preview substitution.
- Existing seven page components compared against HEAD with identical local
  synthetic read data and frozen date; Production data is not copied into mocks.
- Production baseline screenshot retained separately as observational evidence.
- Screenshots are bounded sample coverage, not proof for every page/data state.
- No whole-product WCAG certification is claimed.

## Next Hotel sprint boundary

Foundation ready for a separately approved visual migration, not an automatic
opt-in of HotelOperations. Preserve `HotelRoomBoard` room/stay keys, existing DOM
identity, drag/drop and FLIP hooks. Never remount/reorder for material styling.
`HotelOperations` date/request generations and stale-response guards, PAST
restrictions, 016/016B command paths and interaction locks remain unchanged.
`HotelOperationsWorkspace` four mobile panes (객실/일정/처리 필요/기타 운영) and
`HotelRoomBoardPresentation` lifecycle/time labels must retain their meaning.
Shared, Long Stay and Daycare need visual regression at the adoption boundary;
this foundation sprint does not alter their markup or contracts. Keep room
eligibility, disabled/settling/recommended priority and shared density tests.
