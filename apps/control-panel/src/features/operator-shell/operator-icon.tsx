import type { SVGProps } from "react";

export type OperatorIconName =
  | "home" | "operations" | "captain" | "store" | "catalog" | "marketing"
  | "studio" | "finance" | "people" | "shield" | "bell" | "policy"
  | "search" | "help" | "chevron" | "menu" | "close" | "arrow"
  | "activity" | "chart" | "check" | "clock" | "layers";

export function OperatorIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: OperatorIconName }) {
  const paths: Record<OperatorIconName, React.ReactNode> = {
    home: <><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    operations: <><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v6m8-6v6M4 11h16M8 15h5"/></>,
    captain: <><circle cx="12" cy="7" r="3"/><path d="M5 20v-3a7 7 0 0 1 14 0v3M8 4l4-2 4 2"/></>,
    store: <><path d="M3 10 5 4h14l2 6v3H3v-3Z"/><path d="M5 13v7h14v-7M9 20v-5h6v5M3 10c0 3 4 3 4 0m0 0c0 3 4 3 4 0m0 0c0 3 4 3 4 0m0 0c0 3 4 3 4 0"/></>,
    catalog: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/></>,
    marketing: <><path d="m3 11 12-5v12L3 13v-2ZM15 9h3a3 3 0 0 1 0 6h-3M6 15l2 6h4l-2-5"/></>,
    studio: <><path d="m4 19 3-8 10-8 4 4-8 10-9 2ZM14 6l4 4M7 16l2 2"/></>,
    finance: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m0 3a5 5 0 0 1 4 5v1"/></>,
    shield: <><path d="m12 2 9 4v6c0 6-4 9-9 10-5-1-9-4-9-10V6l9-4Z"/><path d="m8 12 3 3 5-6"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></>,
    policy: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 18h.01"/></>,
    chevron: <path d="m7 10 5 5 5-5"/>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    arrow: <path d="m5 12 14 0m-6-6 6 6-6 6"/>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
    chart: <><path d="M4 20V4M4 20h16M7 15l4-4 3 2 6-8"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    focusable="false" {...props}>{paths[name]}</svg>;
}
