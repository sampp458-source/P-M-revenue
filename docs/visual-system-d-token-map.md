# D experiment → Foundation token map

Exact color/material values are promoted only when they represent a reusable role. Harness-only room tint gradients, drag exclusions, recommendation region selectors and old geometry remain isolated. No automatic production import.

| Approved experiment use | Foundation role | Harness treatment |
|---|---|---|
| warm ivory page | canvas | exact value |
| white primary workspace | workspace | exact value |
| ink shell | sidebar-background / nav tokens | exact value |
| cobalt CTA/selected | brand-cobalt / primary-background / selected-background | exact value |
| KPI hero / page title | type-metric-hero / type-page-title | explicit responsive role |
| metadata / label | type-metadata / type-label | generic class for future adoption |
| workspace/control/divider borders | border / border-control / divider | distinct roles |
| selected and attention outlines | border-selected / border-attention | existing state only |
| empty/active/shared surface | surface-muted / semantic-mint-soft / semantic-cyan-soft | recipe stays in adapter |
| profile count/button | cobalt soft / secondary primitive | existing directory geometry retained |
| recommendation secondary selected | brand-cobalt-soft / selected-ink | actual aria-pressed, not item index |
| fixed legacy14/16/24px geometry | not a global numeric token substitution | harness preserves approved dimensions |

## Token inventory
- `--pm-d-canvas`: `#f6f5f0`
- `--pm-d-workspace`: `#fff`
- `--pm-d-surface`: `#fffefa`
- `--pm-d-surface-muted`: `#f2f3ee`
- `--pm-d-ink`: `#17283d`
- `--pm-d-ink-secondary`: `#465970`
- `--pm-d-ink-muted`: `#617078`
- `--pm-d-border`: `#dde1e3`
- `--pm-d-divider`: `#e3e6e7`
- `--pm-d-brand-ink`: `#17283d`
- `--pm-d-brand-cobalt`: `#245adb`
- `--pm-d-brand-cobalt-soft`: `#edf3ff`
- `--pm-d-semantic-mint`: `#23775b`
- `--pm-d-semantic-mint-soft`: `#edf8f1`
- `--pm-d-semantic-amber`: `#946515`
- `--pm-d-semantic-amber-soft`: `#fff7e8`
- `--pm-d-semantic-coral`: `#b24c3f`
- `--pm-d-semantic-coral-soft`: `#fff2ec`
- `--pm-d-semantic-cyan`: `#287999`
- `--pm-d-semantic-cyan-soft`: `#eaf4fc`
- `--pm-d-on-primary`: `#fff`
- `--pm-d-border-control`: `#cbd9eb`
- `--pm-d-border-selected`: `#8facdc`
- `--pm-d-border-attention`: `#e5c58d`
- `--pm-d-radius-workspace`: `14px`
- `--pm-d-radius-panel`: `11px`
- `--pm-d-radius-control`: `7px`
- `--pm-d-radius-compact-control`: `8px`
- `--pm-d-radius-badge`: `5px`
- `--pm-d-shadow-workspace`: `0 1px 2px #17283d08`
- `--pm-d-shadow-control`: `0 1px 1px #1427380a`
- `--pm-d-shadow-floating`: `0 8px 24px #17283d24`
- `--pm-d-shadow-selected`: `inset 0 1px #ffffff26,0 1px 2px #1b438e22`
- `--pm-d-focus-ring`: `2px solid #245adb`
- `--pm-d-control-min-height`: `44px`
- `--pm-d-workspace-padding`: `24px`
- `--pm-d-panel-padding`: `16px`
- `--pm-d-sidebar-background`: `linear-gradient(165deg,#1d3049 0%,#122136 72%,#192b42 100%)`
- `--pm-d-nav-ink`: `#bccbdc`
- `--pm-d-nav-hover`: `#ffffff0a`
- `--pm-d-nav-selected`: `linear-gradient(110deg,#264f94,#244675)`
- `--pm-d-nav-selected-shadow`: `inset 3px 0 #659aff,inset 0 1px #ffffff14,0 2px 3px #07162b26`
- `--pm-d-shell-divider`: `#ffffff18`
- `--pm-d-header-background`: `#f5f5f2f2`
- `--pm-d-primary-background`: `linear-gradient(#2c65e0,#2156cb)`
- `--pm-d-selected-background`: `#275ed6`
- `--pm-d-selected-ink`: `#214e9a`
- `--pm-d-business-daycare`: `#287999`
- `--pm-d-business-education`: `#3167d5`
- `--pm-d-business-hotel`: `#946515`
- `--pm-d-space-0`: `0px`
- `--pm-d-space-1`: `4px`
- `--pm-d-space-2`: `8px`
- `--pm-d-space-3`: `12px`
- `--pm-d-space-4`: `16px`
- `--pm-d-space-6`: `24px`
- `--pm-d-space-8`: `32px`
- `--pm-d-space-12`: `48px`
- `--pm-d-type-page-title-size`: `33px`
- `--pm-d-type-page-title-weight`: `650`
- `--pm-d-type-page-title-leading`: `1.2`
- `--pm-d-type-page-title-tracking`: `-.045em`
- `--pm-d-type-section-title-size`: `20px`
- `--pm-d-type-section-title-weight`: `650`
- `--pm-d-type-section-title-leading`: `1.4`
- `--pm-d-type-section-title-tracking`: `-.025em`
- `--pm-d-type-entity-title-size`: `19px`
- `--pm-d-type-entity-title-weight`: `650`
- `--pm-d-type-entity-title-leading`: `1.45`
- `--pm-d-type-entity-title-tracking`: `-.025em`
- `--pm-d-type-metric-hero-size`: `52px`
- `--pm-d-type-metric-hero-weight`: `600`
- `--pm-d-type-metric-hero-leading`: `1.18`
- `--pm-d-type-metric-hero-tracking`: `-.06em`
- `--pm-d-type-metric-primary-size`: `32px`
- `--pm-d-type-metric-primary-weight`: `600`
- `--pm-d-type-metric-primary-leading`: `1.2`
- `--pm-d-type-metric-primary-tracking`: `-.04em`
- `--pm-d-type-metric-secondary-size`: `24px`
- `--pm-d-type-metric-secondary-weight`: `600`
- `--pm-d-type-metric-secondary-leading`: `1.25`
- `--pm-d-type-metric-secondary-tracking`: `-.035em`
- `--pm-d-type-body-size`: `14px`
- `--pm-d-type-body-weight`: `400`
- `--pm-d-type-body-leading`: `1.6`
- `--pm-d-type-body-tracking`: `0`
- `--pm-d-type-metadata-size`: `12px`
- `--pm-d-type-metadata-weight`: `400`
- `--pm-d-type-metadata-leading`: `1.5`
- `--pm-d-type-metadata-tracking`: `0`
- `--pm-d-type-label-size`: `14px`
- `--pm-d-type-label-weight`: `500`
- `--pm-d-type-label-leading`: `1.45`
- `--pm-d-type-label-tracking`: `0`
- `--pm-d-type-helper-size`: `12px`
- `--pm-d-type-helper-weight`: `400`
- `--pm-d-type-helper-leading`: `1.5`
- `--pm-d-type-helper-tracking`: `0`
- `--pm-d-type-button-size`: `14px`
- `--pm-d-type-button-weight`: `600`
- `--pm-d-type-button-leading`: `1.4`
- `--pm-d-type-button-tracking`: `-.01em`
- `--pm-d-font-family`: `"Pretendard", -apple-system, sans-serif`
