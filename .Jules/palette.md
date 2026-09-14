## 2026-09-14 - Accessible Modal Close & Inventory Counter Buttons
**Learning:** Icon-only buttons (such as modal close `&times;` and stock adjustment `+`/`-` buttons) need explicit `aria-label` attributes to be readable by screen readers, even when visible text symbols or `title` attributes are present.
**Action:** Always ensure all icon-only interactive controls (`button`, `a`) in views have descriptive `aria-label` attributes.
