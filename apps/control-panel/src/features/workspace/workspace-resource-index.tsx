import Link from "next/link";
import styles from "./workspace-resource-index.module.css";

export type WorkspaceResourceLink = Readonly<{
  href: string;
  label: string;
  description: string;
  source?: string;
}>;

export function WorkspaceResourceIndex({
  title,
  description,
  resources,
}: Readonly<{
  title: string;
  description: string;
  resources: readonly WorkspaceResourceLink[];
}>) {
  return (
    <section className={styles.index} aria-label={title}>
      <div className={styles.heading}>
        <p className="eyebrow">موارد العمل</p>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      <ul className={styles.list}>
        {resources.map((resource) => (
          <li key={resource.href}>
            <Link className={styles.link} href={resource.href}>
              <span className={styles.copy}>
                <span className={styles.label}>{resource.label}</span>
                <span className={styles.description}>{resource.description}</span>
              </span>
              <span className={styles.destination}>
                {resource.source ? <span className={styles.source}>{resource.source}</span> : null}
                <span className={styles.arrow} aria-hidden="true">←</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
