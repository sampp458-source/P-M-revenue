# P&M OS Global UX Design System

## 1. Product principle

P&M OS is an operating platform, not a collection of CRUD screens. A user
opens one entity, understands it, and edits only the necessary part without
moving through unrelated menus.

The standard flow is:

`List → Profile → Local edit`

Avoid:

`List → Edit page → Another list → Another edit page`

## 2. Profile anatomy

Customer, Dog, Schedule, Employee, and future Business profiles follow the
same information order.

1. Header: identity, state, short operational summary, primary actions
2. Core information: the entity's own Master data
3. Related information: linked entities and calculated information
4. Timeline: automatic, read-only, newest first
5. History: actor, timestamp, before/after values, reason when required

Profiles are read-first. Forms are not rendered until the user explicitly
chooses an edit action.

## 3. Editing

- Prefer inline edit for one short value.
- Prefer a modal for a compact group of related fields.
- Use page navigation only for a genuinely separate workflow.
- Return focus to the edit trigger after closing a modal.
- Preserve the open profile and refresh its visible values immediately after
  a successful save.
- Show loading, error, empty, disabled, and saving states separately.

## 4. Master data

- Update the existing Customer, Dog, and Employee Master row.
- Never create a screen-specific copy of Master data.
- Related screens read the same primary key and source row.
- Historical Finance snapshots remain immutable unless their own accounting
  workflow explicitly changes them.
- Physical deletion is not an interaction. Archive or deactivate instead.

## 5. Timeline and history

Timeline and history are different:

- Timeline explains operational events to staff.
- History explains data changes to auditors and managers.

Timeline rules:

- read-only;
- automatic;
- newest first;
- entity-linked by its stable primary key;
- void, archived, cancelled, or entry-error records follow the domain's
  exclusion policy;
- heavy sources load after the profile shell and core information.

History rules:

- store actor and timestamp;
- retain before and after values;
- never replace history with a mutable "last edited by" label;
- do not physically delete audit records.

## 6. Navigation

- Related entity names are navigable when a profile exists.
- Navigation is optional for editing: a phone number or memo must be editable
  from the current profile.
- Back and forward navigation preserve the entity and module context.
- Finance and Operations may link to the same Master entity without copying it.

## 7. Shared visual language

Use existing P&M tokens and shared components.

- surfaces: `surface`, `surface-secondary`, `app-background`
- text: `text-primary`, `text-secondary`, `text-muted`
- border: `border`, `border-strong`
- spacing rhythm: 12–16px inside information groups, 24–32px between sections
- radius: 12px controls, 18–24px profile surfaces and overlays
- shadow: surface shadow only for elevated overlays or selected emphasis
- transition: 150–220ms, no decorative motion
- business-unit color comes from the shared Dashboard Theme Map

Common profile primitives:

- `ProfileContent`
- `ProfileHeader`
- `ProfileSection`
- `ProfileInfoGrid`
- `ProfileField`
- `ProfileTimeline`
- `ProfileTimelineItem`

Do not introduce screen-local replacements for these primitives without a
documented product-level reason.

## 8. Responsive contract

- 320–767px: one column, full-width actions, modal uses available viewport
- 768–1023px: two-column information groups where content permits
- 1024px and above: up to four columns for short fields
- names, notes, addresses, and product names wrap without horizontal overflow
- amounts and quantities use tabular numbers and avoid arbitrary wrapping
- timeline remains one chronological column at every width

## 9. Performance contract

- Open the profile shell from list data immediately.
- Fetch Timeline and History lazily by entity ID.
- Do not load all entity histories with the list.
- Keep core Master reads independent from heavy event queries.
- Clear previous entity event state before loading another profile.

## 10. Delivery checklist

- Profile follows Header → core → related → Timeline → History.
- Editing does not require unrelated navigation.
- Save updates the source Master and current profile.
- Timeline and History have explicit source and exclusion rules.
- Physical deletion is unavailable.
- keyboard focus, Escape, loading, error, and empty states work.
- mobile, tablet, and desktop use the same information hierarchy.
- Finance calculations and snapshots are unchanged unless separately approved.
