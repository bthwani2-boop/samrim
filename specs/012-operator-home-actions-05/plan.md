# Plan — Operator Home actions

Use existing Next App Router, Ant Design and semantic CSS. Follow [spec.md](spec.md), experience and Identity owners.

HomeDashboard in apps/control-panel/src/features/workspace/home-dashboard.tsx consumes visibleWorkspaceEntries and workspaceGroupLabels. Preserve original-Operator verification at the authenticated route and shared permission boundary. No duplicate route/permission list, arbitrary item cap, fabricated metrics or global CSS. Reuse responsive dashboard/sectionGrid and existing icons; preserve owner-backed market view and empty state.

Verify actual permission projection, route and component tests, including original-only, single-scope, all-grants and denial. Run uncached affected type/lint, Next build and authenticated browser on verified runtime. No native Android impact, protected session mutation or new API/SQL. Actual work and acceptance follow AGENTS.md and the authorized owner.
