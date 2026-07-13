import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
