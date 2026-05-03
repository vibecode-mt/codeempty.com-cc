import { useState } from 'react';
import { api } from '../api';

export default function Setup({ onSetup }: { onSetup: () => void }) {
  const [result, setResult] = useState<{ username: string; password: string; message: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    setLoading(true);
    setError('');
    try {
      const r = await api.setup({});
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white shadow rounded-xl p-8 w-full max-w-md space-y-5">
        <h1 className="text-2xl font-bold">First-time Setup</h1>
        <p className="text-gray-600 text-sm">Create the admin account to get started. The password will be shown once.</p>

        {result ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <p className="font-medium text-green-800">Admin account created</p>
              <p className="text-sm text-green-700">Username: <strong>{result.username}</strong></p>
              <p className="text-sm text-green-700">Password: <code className="bg-green-100 px-1 rounded">{result.password}</code></p>
              <p className="text-xs text-green-600 mt-1">{result.message}</p>
            </div>
            <button onClick={onSetup} className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
              Go to Login
            </button>
          </div>
        ) : (
          <>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              onClick={handleSetup}
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? 'Setting up…' : 'Create Admin Account'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
