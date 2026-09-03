'use client';

import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { getScheduledEmails, searchEmails } from '@/lib/api';
import type { Email } from '@/lib/types';
import { Spinner, EmptyState, ErrorMessage, StatusBadge, Button } from '@/components/ui';

// ──────────────────────────────────────────────────────────────────────────────
// ScheduledEmailsView — displays QUEUED/SCHEDULED/RATE_LIMITED emails
// ──────────────────────────────────────────────────────────────────────────────

export default function ScheduledEmailsView() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 20;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetch = useCallback(async (p = 1, query = '') => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (query.trim() !== '') {
        res = await searchEmails({ q: query, status: 'QUEUED', page: p, pageSize: PAGE_SIZE });
      } else {
        res = await getScheduledEmails({ page: p, pageSize: PAGE_SIZE });
      }
      setEmails(res.data);
      setTotalPages(res.meta.totalPages);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheduled emails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(1, debouncedQuery); }, [fetch, debouncedQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Scheduled Emails</h2>
          <p className="text-sm text-slate-500 mt-0.5">Emails waiting to be sent</p>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors w-64"
          />
          <Button variant="secondary" onClick={() => fetch(page, debouncedQuery)} id="refresh-scheduled-btn">
            ↻ Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => fetch(page)} />
      ) : emails.length === 0 ? (
        <EmptyState
          icon="📭"
          title={debouncedQuery ? "No results found" : "No scheduled emails"}
          description={debouncedQuery ? "Try adjusting your search query." : "Schedule a new batch using the Compose tab to see emails here."}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50">
                <tr>
                  {['Recipient', 'Subject', 'Scheduled At', 'Status', 'Attempts'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {emails.map(email => (
                  <tr key={email.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-slate-300 font-medium">{email.recipient}</td>
                    <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">{email.subject}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {format(new Date(email.scheduledAt), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-center">{email.attemptCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => fetch(page - 1, debouncedQuery)}
                id="prev-scheduled-page"
              >
                ← Previous
              </Button>
              <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => fetch(page + 1, debouncedQuery)}
                id="next-scheduled-page"
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
