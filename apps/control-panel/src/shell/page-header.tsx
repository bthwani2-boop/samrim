import type { ReactNode } from "react";

export function PageHeader({ title, id, actions, status }: Readonly<{
  title: ReactNode;
  id?: string;
  actions?: ReactNode;
  status?: ReactNode;
}>) {
  return <header className="page-header"><div className="page-header-title"><h1 id={id}>{title}</h1>{status}</div>{actions ? <div className="action-row">{actions}</div> : null}</header>;
}
