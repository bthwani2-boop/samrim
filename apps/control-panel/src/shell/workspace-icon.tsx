const paths = {
  home: "M3 10 12 3l9 7v10H3ZM9 20v-7h6v7",
  operations: "M4 5h16v14H4ZM4 10h16M9 5v14",
  partners: "M15 20v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3M16 5a4 4 0 0 1 0 8M21 20v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  catalog: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
  marketing: "m3 10 13-5v14L3 14Zm13-2 5 2v4l-5 2M6 15l2 6h4l-2-5",
  finance: "M3 6h18v14H3ZM3 6V4h15M16 11h5v5h-5ZM17 13h1",
  policies: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  access: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6ZM9 12l2 2 4-4",
} as const;
const icons: Record<string, keyof typeof paths> = { "/workspace": "home", "/operations": "operations", "/partners": "partners", "/catalog": "catalog", "/marketing": "marketing", "/finance": "finance", "/policies": "policies", "/access": "access" };
export function WorkspaceIcon({ href }: Readonly<{ href: string }>) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[icons[href] ?? "home"]} /></svg>;
}
