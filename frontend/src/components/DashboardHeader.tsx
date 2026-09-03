'use client';

import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// DashboardHeader — shows user info and logout
// ──────────────────────────────────────────────────────────────────────────────

export function DashboardHeader({ activeTab, onTabChange }: {
  activeTab: 'scheduled' | 'sent' | 'compose';
  onTabChange: (tab: 'scheduled' | 'sent' | 'compose') => void;
}) {
  const auth = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  if (auth.status !== 'authenticated') return null;
  const { user } = auth;

  const handleLogout = async () => {
    setLoggingOut(true);
    await auth.logout();
    window.location.href = '/login';
  };

  const tabs: { key: 'scheduled' | 'sent' | 'compose'; label: string; icon: string }[] = [
    { key: 'scheduled', label: 'Scheduled', icon: '📅' },
    { key: 'sent',      label: 'Sent',      icon: '✅' },
    { key: 'compose',   label: 'Compose',   icon: '✏️' },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Top bar: brand + user */}
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white font-bold text-sm">
              R
            </div>
            <span className="font-semibold text-slate-100 text-lg tracking-tight">
              ReachInbox
            </span>
          </div>

          {/* User avatar + name + logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-sm font-medium text-slate-200">{user.name}</span>
              <span className="text-xs text-slate-500">{user.email}</span>
            </div>
            {user.avatar ? (
              <Image
                src={user.avatar}
                alt={user.name}
                width={36}
                height={36}
                className="rounded-full ring-2 ring-slate-700"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-white font-semibold text-sm">
                {user.name[0]?.toUpperCase()}
              </div>
            )}
            <Button
              variant="ghost"
              onClick={handleLogout}
              loading={loggingOut}
              className="text-slate-400 text-xs"
              id="logout-btn"
            >
              Logout
            </Button>
          </div>
        </div>

        {/* Tab navigation */}
        <nav className="flex gap-1 -mb-px" role="tablist" aria-label="Dashboard sections">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              id={`tab-${tab.key}`}
              onClick={() => onTabChange(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
