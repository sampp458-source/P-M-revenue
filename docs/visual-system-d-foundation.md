# Visual System D Foundation

Status: opt-in foundation only. Approved D v1 Golden screens define appearance. No production rollout, imports, page JSX, route, V2 file deletion or business changes.

## Scope and use
`src/visual-system-d.css` defines tokens on `.pm-design-d` and classes beneath that scope in `@layer pm-d`. It contains no page-specific selector, global reset or `!important`. Apply the scope to a parent, primitives to descendants. It is intentionally **not imported** by the production bundle.

Future integration example (not applied):
```html
<div class="pm-design-d">
  <main class="pm-d-page">
    <h1 class="pm-d-type-page-title">호텔 운영</h1>
    <section class="pm-d-workspace">
      <h2 class="pm-d-type-section-title">객실 현황</h2>
      <button class="pm-d-button-primary">새 일정</button>
    </section>
  </main>
</div>
```
No wrapper component or handler is introduced. Use the existing native element and its label, disabled state, focus handling and event contract.

## Palette
Warm matte canvas `#f6f5f0`, white workspace, warm near-white surface, deep ink `#17283d`, cobalt `#245adb`. Secondary and muted inks are separate. Brand cobalt is selection/action, not a universal business color.

Mint indicates success/active, amber attention, coral destructive/refund, cyan selective operational information. Soft pairs exist for all four. Never rely on color alone: retain the existing visible label/icon. Never automatically classify a row from its text.

Business palette is contextual: Daycare cyan, Education blue, Hotel amber are current approved small markers. Hotel amber business marker does not imply an alert. Use category labels and restrained markers for business identity; use explicit status label and semantic tint for attention. Mint must not become an arbitrary division brand. Permission/customer-defined business colors remain authoritative when provided by existing behavior.

## Typography (Korean first)
| Role | Size | Weight | Leading | Tracking |
|---|---|---|---|---|
|page-title|33px|650|1.2|-.045em|
|section-title|20px|650|1.4|-.025em|
|entity-title|19px|650|1.45|-.025em|
|metric-hero|52px|600|1.18|-.06em|
|metric-primary|32px|600|1.2|-.04em|
|metric-secondary|24px|600|1.25|-.035em|
|body|14px|400|1.6|0|
|metadata|12px|400|1.5|0|
|label|14px|500|1.45|0|
|helper|12px|400|1.5|0|
|button|14px|600|1.4|-.01em|

Pretendard with system fallback. Metrics use tabular numerals. Metadata/helper share metrics deliberately but are distinct semantic roles. Long Korean entity names keep existing wrapping. Font loading/subsetting is not changed.

## Spacing and responsive
Scale: 0 /4 /8 /12 /16 /24 /32 /48px. Workspace padding24, panel16; <=767px workspace16/panel12 and workspace radius12. Control minimum height remains44px. Mobile title28, entity17, hero37, primary metric23, secondary18.

768+ retains desktop tokens; no new tablet layout breakpoint. Existing application 768/1024/1280 pane/navigation behavior is untouched. Foundation does not set grids, reordering, truncation or column visibility. Compact control refers to shape, not reducing the hit area.

## Material / border / radius
PASSIVE flat. Workspace subtle elevation. Input crisp. Primary tactile. Selected cobalt + controlled depth. Default panel/row/status shadow is none.

Radius roles: workspace14 (mobile12), panel11, control7, compact-control8, badge5. Compact-control8 is the group track/object contour; child controls7 fit inside it. This is a role distinction, not a size ladder.

Border recipes: workspace 1px `border`; control 1px `border-control`; divider 1px `divider`; selected 1px `border-selected`; attention 1px `border-attention`. All values live in tokens; color and role are separate.

Only four shadow roles: workspace, control, floating, selected. Primary uses selected depth with its cobalt surface. Passive data has no generic shadow.

## Primitives
Page / workspace / panel / directory / row; control / input / select / search; primary / secondary / ghost / icon button; segmented / tab; badge / status; metric / hero metric; section rail / divider; overlay / drawer / modal. All are `pm-d-*` classes. Native inputs, selects, buttons and table semantics stay native.

`aria-selected=true` or `aria-pressed=true` selects an opted-in tab/control only when the existing application state says so. Do not set ARIA attributes for styling. Disabled native button gets subdued appearance; no pointer-events bypass is added. Focus-visible has2px cobalt outline +2px offset. Motion and hover translations are not introduced.

Overlay/drawer/modal classes only supply material. They do not create a portal, stacking layer, fixed positioning, focus trap, scroll lock, dismissal or modal role. Those behaviors remain with the existing component. If a portal is adopted later it needs its own `.pm-design-d` ancestor; do not move the whole application into the scope as a shortcut.

## Shell
Deep ink tonal sidebar; muted normal icon/text; selected cobalt-tinted surface with a small inset/contact highlight. Logo/account regions remain compact. Header/mobile-header warm near-white and flat. Nav `aria-current=page` comes from the router, not this stylesheet. Sidebar width/position/mobile open-close behavior is outside Foundation.

## Do / don't
- Do: flat row + divider + entity typography. Don't: new floating card for every row.
- Do: cobalt for real selected state. Don't: first recommendation styled selected because it is first.
- Do: status text plus semantic tint. Don't: tint an entire workspace with every division color.
- Do: retain 44px input/action target where adopted. Don't: reduce Korean font size to force fit.
- Do: use the scoped Foundation and explicit visual role. Don't: add `.hotel-*` or `nth-child` screen hacks to Foundation.

## Golden bridge / limits
The isolated `harness-adapter.css` maps existing approved DOM selectors to 38 distinct D token references; final usage is counted in validation artifacts. Fixed existing geometry remains in the adapter. A 14px legacy radius is not blindly mapped to an adaptive workspace token when it is actually an input text size. Mobile token recipes are for explicit role adoption, not global number replacement.

Golden pages use D token values and role classes for title/metric/entity/sidebar. Existing dense screen geometry and legacy-specific compatibility rules remain in the harness adapter. This proves token/visual parity on the8 Golden renders; it does not claim that every legacy class has already been replaced by generic primitives. `primitives.html` independently renders the remaining generic material roles. Further page rollout requires explicit role mapping and state QA.

Full business suite not repeated. CSS AST scope/token validation, lint, TypeScript/build and actual Golden/representative unopted local production-component renders are used. Production service is not touched.
