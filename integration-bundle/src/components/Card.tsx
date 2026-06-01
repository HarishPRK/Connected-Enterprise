import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, sub, right, children, className }: CardProps) {
  return (
    <div className={`card ${className ?? ''}`}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
