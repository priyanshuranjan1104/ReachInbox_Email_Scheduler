import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '@/hooks/useAuth';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReachInbox — Email Scheduler',
  description: 'Schedule and manage bulk email campaigns with rate limiting and Slack notifications.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        <AuthProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid #334155',
              },
              success: { iconTheme: { primary: '#a78bfa', secondary: '#1e293b' } },
              error:   { iconTheme: { primary: '#f87171', secondary: '#1e293b' } },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
