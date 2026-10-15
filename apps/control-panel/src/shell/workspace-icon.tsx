const paths = {
  home: "M3 10 12 3l9 7v10H3ZM9 20v-7h6v7",
  operations: "M4 5h16v14H4ZM4 10h16M9 5v14",
  partners: "M15 20v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3M16 5a4 4 0 0 1 0 8M21 20v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  catalog: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
  marketing: "m3 10 13-5v14L3 14Zm13-2 5 2v4l-5 2M6 15l2 6h4l-2-5",
  finance: "M3 6h18v14H3ZM3 6V4h15M16 11h5v5h-5ZM17 13h1",
  policies: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  access: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6ZM9 12l2 2 4-4",
  active: "M21 12a9 9 0 1 1-5-8M8 11l4 4L22 5",
  pending: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  paused: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 8v8M15 8v8",
  ended: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12l3 3 5-6",
  unknown: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01",
  published: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  unpublished: "M5 3h9l5 5v13H5ZM14 3v6h5M8 15h8",
  hidden: "m3 3 18 18M9 5c1-.3 2-.5 3-.5 6 0 10 7.5 10 7.5s-1 2-3 4M6 6C3 8 2 12 2 12s4 7.5 10 7.5c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4",
  rider: "M8 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 17l5-8h4l5 8M8 17h5l-3-8M13 5h3l3 12M7 9H4",
  storeDelivery: "M3 4h12l2 5H1ZM3 9v10h8M6 19v-6h4M14 15h8m-3-3 3 3-3 3",
  pickup: "M4 9h16l-1 12H5ZM8 9V7a4 4 0 0 1 8 0v2M9 15l2 2 4-4",
  map: "M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0ZM14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  employees: "M4 3h16v18H4ZM15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 18v-2a5 5 0 0 1 10 0v2",
  review: "M5 3h14v18H5ZM8 8h8M8 12h4M10 17l2 2 5-5",
  field: "M12 3 3 7l9 4 9-4ZM3 7v10l9 4 9-4V7M12 11v10",
  trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  import: "M4 14v7h16v-7M12 3v12M7 10l5 5 5-5",
  categories: "M10 3h4v4h-4ZM3 17h4v4H3ZM10 17h4v4h-4ZM17 17h4v4h-4ZM12 7v6M5 17v-4h14v4M12 13v4",
  content: "M3 4h18v16H3ZM3 15l5-5 6 6 3-3 4 4M16 8h.01",
  cash: "M2 6h20v12H2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 9h.01M19 15h.01",
} as const;
export type OperationalIconName = keyof typeof paths;
const icons: Record<string, OperationalIconName> = { "/workspace": "home", "/operations": "operations", "/partners": "partners", "/catalog": "catalog", "/marketing": "marketing", "/finance": "finance", "/policies": "policies", "/access": "access", "/hr": "employees", "/hr/employees": "employees", "/fields": "field", "/captains": "rider", "/partners/joining": "review", "/catalog/products": "pickup", "/catalog/categories": "categories", "/catalog/trash": "trash", "/catalog/proposals": "review", "/catalog/import": "import", "/marketing/promotions": "marketing", "/marketing/content": "content", "/policies/service-cities": "map", "/policies/wallet-providers": "finance", "/policies/delivery-fees": "rider", "/policies/field-acquisition": "field", "/policies/partner-financial-terms": "review", "/finance/cash-custody": "cash", "/finance/partner-store-commissions": "review", "/finance/beneficiary-settlement": "finance", "/finance/customer-withdrawals": "import", "/finance/partner-commission-receivables": "cash", "/operations/customer-withdrawals": "import" };
export function OperationalIcon({ name }: Readonly<{ name: OperationalIconName }>) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
export function WorkspaceIcon({ href }: Readonly<{ href: string }>) {
  return <OperationalIcon name={icons[href] ?? icons[href.slice(0, href.lastIndexOf("/"))] ?? "operations"} />;
}
