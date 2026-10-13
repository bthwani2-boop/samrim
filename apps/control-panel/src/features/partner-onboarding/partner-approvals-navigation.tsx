import Link from "next/link";

const views = [
  { href: "/partners/joining", label: "طلبات الانضمام" },
  { href: "/partners/store-access", label: "اعتمادات الوصول" },
] as const;

export function PartnerApprovalsNavigation({ current }: Readonly<{ current: "joining" | "store-access" }>) {
  return (
    <nav className="detail-tabs" aria-label="نوع الطلب أو الاعتماد">
      {views.map((view) => (
        <Link key={view.href} href={view.href} aria-current={view.href === (current === "joining" ? views[0].href : views[1].href) ? "page" : undefined}>
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
