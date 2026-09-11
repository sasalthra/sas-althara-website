'use client';

import {useState} from 'react';
import {signIn, signOut} from 'next-auth/react';

export function LoginButton() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      username,
      password,
      redirect: false,
      callbackUrl: '/crm',
    });

    setLoading(false);

    if (!result || result.error) {
      setError('اسم المستخدم أو كلمة المرور غير صحيحة');
      return;
    }

    window.location.href = '/crm';
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            اسم المستخدم
          </label>

          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            كلمة المرور
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => void signIn('google', {callbackUrl: '/crm'})}
        className="w-full rounded-lg border px-4 py-2"
      >
        الدخول بحساب Google
      </button>
    </div>
  );
}

export function LogoutButton() {
  return (
    <button onClick={() => void signOut({callbackUrl: '/crm'})}>
      تسجيل الخروج
    </button>
  );
}