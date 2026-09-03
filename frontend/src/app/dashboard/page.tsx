'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DashboardHeader } from '@/components/DashboardHeader';
import ScheduledEmailsView from '@/components/ScheduledEmailsView';
import SentEmailsView from '@/components/SentEmailsView';
import ComposeView from '@/components/ComposeView';
import { Spinner } from '@/components/ui';

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard page — protected, requires authentication
// ──────────────────────────────────────────────────────────────────────────────

type Tab = 'scheduled' | 'sent' | 'compose';

export default function DashboardPage() {
  const auth = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [scheduledKey, setScheduledKey] = useState(0); // force re-mount to refresh

  // Guard: redirect to login if not authenticated
  useEffect(() => {
    if (auth.status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [auth.status, router]);

  if (auth.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (auth.status === 'unauthenticated') {
    // Will redirect in useEffect, show loading in the meantime
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const handleComposeSuccess = () => {
    // After successful scheduling, switch to Scheduled tab and reload
    setActiveTab('scheduled');
    setScheduledKey(k => k + 1);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8" role="main">
        {activeTab === 'scheduled' && (
          <div key={scheduledKey}>
            <ScheduledEmailsView />
          </div>
        )}
        {activeTab === 'sent' && <SentEmailsView />}
        {activeTab === 'compose' && (
          <ComposeView onSuccess={handleComposeSuccess} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-600">
        ReachInbox Email Scheduler · Phase 7
      </footer>
    </div>
  );
}
