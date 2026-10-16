import React from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * Shared visual frame for the redesigned admin pages.
 * The child remains the original API-backed page component; this wrapper only
 * owns the page heading and surface spacing so functionality is not duplicated.
 */
const AdminPageFrame = ({ kicker, title, description, children, actions, className = '' }) => (
  <main className={`zjugis-page ${className}`.trim()}>
    <header className="zjugis-page-header">
      <div>
        <div className="zjugis-eyebrow">{kicker}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="zjugis-page-actions">{actions}</div>}
    </header>
    <section className="zjugis-page-content">
      {children}
    </section>
  </main>
);

export const PageLink = ({ href = '#', children }) => (
  <a className="zjugis-card-link" href={href}>
    {children} <ArrowUpRight size={14} />
  </a>
);

export default AdminPageFrame;
