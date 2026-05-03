import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  user: { username: string };
  onLogout: () => void;
  children: ReactNode;
}

const nav = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/projects', label: 'Projects' },
  { to: '/pages', label: 'Pages' },
  { to: '/blog', label: 'Blog' },
  { to: '/scripts', label: 'Scripts' },
  { to: '/oauth', label: 'API Apps' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout({ user, onLogout, children }: Props) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-900 text-gray-100 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-700">
          <span className="font-bold text-lg tracking-tight">CodeEmpty CMS</span>
        </div>
        <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `px-3 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-700 text-sm text-gray-400">
          <div className="mb-1 font-medium text-gray-200">{user.username}</div>
          <button onClick={onLogout} className="text-gray-400 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  );
}
