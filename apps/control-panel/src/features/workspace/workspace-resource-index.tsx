import Link from "next/link";

export type WorkspaceResourceLink = Readonly<{
  href: string;
  label: string;
}>;

export function WorkspaceResourceIndex({
  title,
  resources,
}: Readonly<{
  title: string;
  resources: readonly WorkspaceResourceLink[];
}>) {
  return (
    <nav className="resource-index" aria-label={title}>
      <ul className="resource-links">
        {resources.map((resource) => (
          <li key={resource.href}>
            <Link className="resource-link" href={resource.href}>
              <span>{resource.label}</span>
              <span aria-hidden="true">←</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
