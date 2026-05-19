import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  user: { username: string };
  onLogout: () => void;
  children: ReactNode;
}

const nav = [
  { to: '/', label: 'Dashboard', abbr: 'D', exact: true },
  { to: '/projects', label: 'Projects', abbr: 'P' },
  { to: '/pages', label: 'Pages', abbr: 'Pg' },
  { to: '/blog', label: 'Blog', abbr: 'B' },
  { to: '/scripts', label: 'Scripts', abbr: 'S' },
  { to: '/forms', label: 'Forms', abbr: 'F', exact: true },
  { to: '/forms/submissions', label: 'Form Data', abbr: 'FD' },
  { to: '/oauth', label: 'API Apps', abbr: 'A' },
  { to: '/destinations', label: 'Destinations', abbr: 'Dst' },
  { to: '/settings', label: 'Settings', abbr: '⚙' },
  { to: '/logs', label: 'Logs', abbr: 'L' },
];

export default function Layout({ user, onLogout, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebarOpen') !== 'false'; } catch { return true; }
  });

  function toggle() {
    setOpen((v) => {
      try { localStorage.setItem('sidebarOpen', String(!v)); } catch {}
      return !v;
    });
  }

  return (
    <div className="min-h-screen flex">
      <aside className={`bg-gray-900 text-gray-100 flex flex-col shrink-0 transition-all duration-200 ${open ? 'w-56' : 'w-12'}`}>
        {/* Header */}
        <div className={`flex items-center border-b border-gray-700 ${open ? 'px-5 py-4 justify-between' : 'px-2 py-4 justify-center'}`}>
          {open && <span className="font-bold text-lg tracking-tight truncate">CodeEmpty CMS</span>}
          <button
            onClick={toggle}
            className="text-gray-400 hover:text-white transition-colors shrink-0 p-1 rounded hover:bg-gray-800"
            title={open ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {open ? '←' : '→'}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2">
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className={`flex items-center rounded text-sm font-medium transition-colors text-gray-300 hover:bg-gray-800 hover:text-white ${open ? 'px-3 py-2 gap-2' : 'px-0 py-2 justify-center'}`}
            title={!open ? 'Visit Website' : undefined}
          >
            {open ? 'Visit Website ↗' : <span className="text-xs font-bold">↗</span>}
          </a>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center rounded text-sm font-medium transition-colors ${open ? 'px-3 py-2 gap-2' : 'px-0 py-2 justify-center'} ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`
              }
              title={!open ? item.label : undefined}
            >
              {open ? item.label : <span className="text-xs font-bold">{item.abbr}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className={`border-t border-gray-700 text-sm text-gray-400 ${open ? 'px-4 py-3' : 'px-2 py-3 flex flex-col items-center gap-1'}`}>
          {open ? (
            <>
              <div className="mb-1 font-medium text-gray-200 truncate">{user.username}</div>
              <button onClick={onLogout} className="text-gray-400 hover:text-white transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <button onClick={onLogout} title="Sign out" className="text-gray-400 hover:text-white transition-colors text-xs">
              ⏻
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8 min-w-0">
        {children}
      </main>
    </div>
  );
}
