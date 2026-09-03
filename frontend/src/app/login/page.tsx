'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getGoogleLoginUrl } from '@/lib/api';
import { Spinner } from '@/components/ui';

// ──────────────────────────────────────────────────────────────────────────────
// Login page
// ──────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  // Redirect if already authenticated
  useEffect(() => {
    if (auth.status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [auth.status, router]);

  if (auth.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const handleGoogleLogin = () => {
    // Redirect to the real backend OAuth endpoint
    window.location.href = getGoogleLoginUrl();
  };

  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/30 via-slate-950 to-slate-950 pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600 shadow-lg shadow-violet-900/50">
            <span className="text-3xl font-bold text-white">R</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">ReachInbox</h1>
            <p className="text-slate-400 text-sm mt-1">Email scheduling, rate limiting & analytics</p>
          </div>
        </div>

        {/* Login card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6 shadow-2xl shadow-black/50">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-100">Welcome back</h2>
            <p className="text-slate-400 text-sm mt-1">Sign in to access your dashboard</p>
          </div>

          <button
            id="google-login-btn"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-semibold rounded-xl px-4 py-3 transition-all duration-150 shadow-md hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {/* Google logo SVG */}
            <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M47.532 24.5528C47.532 22.9214 47.3997 21.2811 47.1175 19.6761H24.48V28.9181H37.4434C36.9055 31.8988 35.177 34.5356 32.6461 36.2111V42.2078H40.3801C44.9217 38.0278 47.532 31.8547 47.532 24.5528Z" fill="#4285F4"/>
              <path d="M24.48 48.0016C30.9529 48.0016 36.4116 45.8764 40.3888 42.2078L32.6549 36.2111C30.5031 37.675 27.7252 38.5039 24.4888 38.5039C18.2275 38.5039 12.9187 34.2798 11.0139 28.6006H3.03296V34.7825C7.10718 42.8868 15.4056 48.0016 24.48 48.0016Z" fill="#34A853"/>
              <path d="M11.0051 28.6006C9.99973 25.6199 9.99973 22.3922 11.0051 19.4115V13.2296H3.03298C-0.371021 20.0112 -0.371021 28.0009 3.03298 34.7825L11.0051 28.6006Z" fill="#FBBC04"/>
              <path d="M24.48 9.49932C27.9016 9.44641 31.2086 10.7339 33.6866 13.0973L40.5387 6.24523C36.2 2.17101 30.4414 -0.068932 24.48 0.00161733C15.4055 0.00161733 7.10718 5.11644 3.03296 13.2296L11.005 19.4115C12.901 13.7235 18.2187 9.49932 24.48 9.49932Z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-xs text-slate-500">
            By signing in, you agree to our terms of service.
            <br />
            We only access your email and profile name.
          </p>
        </div>

        <p className="text-center text-xs text-slate-600">
          Powered by BullMQ · Redis · PostgreSQL
        </p>
      </div>
    </main>
  );
}
