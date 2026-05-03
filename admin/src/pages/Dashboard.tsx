import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState({ projects: 0, pages: 0, blog: 0 });

  useEffect(() => {
    Promise.all([api.listProjects(), api.listPages(), api.listBlog()]).then(([p, pg, b]) => {
      setStats({ projects: p.length, pages: pg.length, blog: b.length });
    });
  }, []);

  const cards = [
    { label: 'Projects', count: stats.projects, to: '/projects', color: 'bg-blue-50 text-blue-700' },
    { label: 'Pages', count: stats.pages, to: '/pages', color: 'bg-purple-50 text-purple-700' },
    { label: 'Blog entries', count: stats.blog, to: '/blog', color: 'bg-green-50 text-green-700' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className={`rounded-xl p-6 ${c.color} hover:opacity-90 transition-opacity`}>
            <div className="text-3xl font-bold">{c.count}</div>
            <div className="text-sm font-medium mt-1">{c.label}</div>
          </Link>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-6">
        <h2 className="font-semibold mb-3">Quick links</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/projects/new" className="px-3 py-1.5 border rounded hover:bg-gray-50">+ New project</Link>
          <Link to="/blog/new" className="px-3 py-1.5 border rounded hover:bg-gray-50">+ New blog entry</Link>
          <Link to="/scripts" className="px-3 py-1.5 border rounded hover:bg-gray-50">Manage scripts</Link>
          <Link to="/oauth" className="px-3 py-1.5 border rounded hover:bg-gray-50">API apps</Link>
          <a href="/" target="_blank" rel="noopener" className="px-3 py-1.5 border rounded hover:bg-gray-50">View site ↗</a>
        </div>
      </div>
    </div>
  );
}
