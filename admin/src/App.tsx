import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectEdit from './pages/ProjectEdit';
import Pages from './pages/Pages';
import PageEdit from './pages/PageEdit';
import Blog from './pages/Blog';
import BlogEdit from './pages/BlogEdit';
import Scripts from './pages/Scripts';
import OAuthApps from './pages/OAuthApps';
import Destinations from './pages/Destinations';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Migrations from './pages/Migrations';
import FormSetupGuide from './pages/ContactSetupGuide';
import Forms from './pages/Forms';
import FormEdit from './pages/FormEdit';
import FormSubmissions from './pages/FormSubmissions';

export default function App() {
  const [user, setUser] = useState<{ username: string } | null | undefined>(undefined);

  useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>;
  }

  if (user === null) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup onSetup={() => window.location.href = '/admin/login'} />} />
        <Route path="/login" element={<Login onLogin={() => api.me().then(setUser)} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout user={user} onLogout={() => { api.logout(); setUser(null); }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<ProjectEdit />} />
        <Route path="/projects/:id" element={<ProjectEdit />} />
        <Route path="/pages" element={<Pages />} />
        <Route path="/pages/new" element={<PageEdit />} />
        <Route path="/pages/:id" element={<PageEdit />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/new" element={<BlogEdit />} />
        <Route path="/blog/:id" element={<BlogEdit />} />
        <Route path="/scripts" element={<Scripts />} />
        <Route path="/oauth" element={<OAuthApps />} />
        <Route path="/destinations" element={<Destinations />} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/forms/new" element={<FormEdit />} />
        <Route path="/forms/submissions" element={<FormSubmissions />} />
        <Route path="/forms/:id" element={<FormEdit />} />
        <Route path="/forms/setup" element={<FormSetupGuide />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/migrations" element={<Migrations />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
