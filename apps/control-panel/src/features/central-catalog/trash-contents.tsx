"use client";

import { useState } from "react";
import { useSession } from "../../session/session-provider";
import { CatalogCategoryTrash } from "./catalog-category-trash";
import { CatalogTrash } from "./catalog-trash";
import { StoreTrash } from "./store-trash";

type TrashKind = "products" | "categories" | "stores";

export function TrashContents() {
  const { state } = useSession();
  const [selected, setSelected] = useState<TrashKind>("products");
  if (state.kind !== "authenticated" || state.identity.role !== "operator") return null;

  const permissions = state.identity.permissions ?? [];
  const sections: ReadonlyArray<{ key: TrashKind; label: string }> = [
    ...(permissions.includes("catalog") ? [
      { key: "products" as const, label: "المنتجات" },
      { key: "categories" as const, label: "الفئات" },
    ] : []),
    ...(permissions.includes("partners") ? [{ key: "stores" as const, label: "المتاجر" }] : []),
  ];
  const active: TrashKind = sections.some((section) => section.key === selected)
    ? selected
    : (sections[0]?.key ?? "products");

  return (
    <div className="catalog-taxonomy-workspace">
      <div className="catalog-category-filters">
        <span className="muted">نوع العنصر</span>
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={active === section.key ? "button button-primary" : "button button-secondary"}
            aria-pressed={active === section.key}
            onClick={() => setSelected(section.key)}
          >
            {section.label}
          </button>
        ))}
      </div>
      {active === "products" && permissions.includes("catalog") ? <CatalogTrash /> : null}
      {active === "categories" && permissions.includes("catalog") ? <CatalogCategoryTrash /> : null}
      {active === "stores" && permissions.includes("partners") ? <StoreTrash /> : null}
    </div>
  );
}
