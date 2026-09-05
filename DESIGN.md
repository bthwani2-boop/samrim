# BThwani surface design

This is the implementation-facing visual brief for the current Arabic-first
operational surfaces. Durable product meaning remains in
`governance/product/EXPERIENCE-AND-DESIGN.md`; runtime values remain in
`packages/design-system`.

## Direction

- Use a warm, quiet work surface (`#FFFCF8`) with white working cards.
- Use navy (`#0A2F5C`) for structure, hierarchy and readable text.
- Use orange (`#FF500D`) only for the governed primary action and active focus.
- Keep the brand signature consistent: a small orange rail, a clear navy wordmark,
  generous but bounded spacing, and one dominant action per state.
- Arabic is the reading lane. Technical identifiers are secondary and never the
  headline of a successful user task.

## Patterns

- Role apps open with one focused activation surface. Phone, code and the next
  legal action are visible in sequence; no decorative controls compete with it.
- A successful role session shows readiness and a recoverable device-session
  action. It does not expose actor identifiers unless the task requires them.
- Control-panel sign-in is a two-step form: password first, second factor second.
  The current step, required input, busy state and recovery action are explicit.
- All recoverable failures are Arabic, actionable and safe to repeat. Raw service
  errors are not rendered to operators.
- Loading, unavailable, empty and authenticated states use the same shell so the
  page does not jump between unrelated visual systems.

## Implementation

Mobile surfaces consume semantic tokens from `@bthwani/design-system`. The web
surface mirrors those same semantic roles through CSS variables because its
layout is CSS-native. New screens should extend the shared roles rather than
introduce a local palette or a second RTL convention.
