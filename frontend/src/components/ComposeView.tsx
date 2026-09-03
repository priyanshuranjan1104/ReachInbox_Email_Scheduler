'use client';

import { useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { createJob, createJobWithCsv } from '@/lib/api';
import { Input, Textarea, Button } from '@/components/ui';
import type { CreateJobInput } from '@/lib/types';

// ──────────────────────────────────────────────────────────────────────────────
// ComposeView — form to schedule a new email batch
// ──────────────────────────────────────────────────────────────────────────────

type FormErrors = Partial<Record<keyof Fields | 'recipients', string>>;

type Fields = {
  subject: string;
  body: string;
  senderEmail: string;
  senderName: string;
  scheduledAt: string;
  delayBetweenEmailsMs: string;
  hourlyLimit: string;
};

// Parse a CSV/TXT file to extract email addresses
function parseEmailsFromText(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = text.match(emailRegex) ?? [];
  // Deduplicate
  return [...new Set(found)];
}

type UploadMode = 'text' | 'csv';

interface ComposeViewProps {
  onSuccess?: () => void;
}

export default function ComposeView({ onSuccess }: ComposeViewProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [fields, setFields] = useState<Fields>({
    subject: '',
    body: '',
    senderEmail: '',
    senderName: '',
    scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16),
    delayBetweenEmailsMs: '2000',
    hourlyLimit: '100',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>('text');
  const [pastedEmails, setPastedEmails] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detectedEmails, setDetectedEmails] = useState<string[]>([]);

  // ── Field change handler ────────────────────────────────────────────────────

  const set = useCallback(<K extends keyof Fields>(key: K, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }, []);

  // ── Email parsing ───────────────────────────────────────────────────────────

  const handleTextChange = (text: string) => {
    setPastedEmails(text);
    const found = parseEmailsFromText(text);
    setDetectedEmails(found);
    setErrors(prev => ({ ...prev, recipients: undefined }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const text = await file.text();
    const found = parseEmailsFromText(text);
    setDetectedEmails(found);
    setErrors(prev => ({ ...prev, recipients: undefined }));
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: FormErrors = {};

    if (!fields.subject.trim()) errs.subject = 'Subject is required';
    if (!fields.body.trim()) errs.body = 'Body is required';
    if (!fields.senderEmail.trim()) {
      errs.senderEmail = 'Sender email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.senderEmail)) {
      errs.senderEmail = 'Invalid email address';
    }
    if (!fields.scheduledAt) errs.scheduledAt = 'Scheduled time is required';
    const delay = Number(fields.delayBetweenEmailsMs);
    if (isNaN(delay) || delay < 0) errs.delayBetweenEmailsMs = 'Must be a non-negative number';
    const limit = Number(fields.hourlyLimit);
    if (isNaN(limit) || limit < 1) errs.hourlyLimit = 'Must be at least 1';
    if (detectedEmails.length === 0) errs.recipients = 'At least one recipient email is required';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submission ──────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      if (uploadMode === 'csv' && selectedFile) {
        // Use multipart form for CSV upload
        const formData = new FormData();
        formData.append('subject', fields.subject);
        formData.append('body', fields.body);
        formData.append('senderEmail', fields.senderEmail);
        if (fields.senderName) formData.append('senderName', fields.senderName);
        formData.append('scheduledAt', new Date(fields.scheduledAt).toISOString());
        formData.append('delayBetweenEmailsMs', fields.delayBetweenEmailsMs);
        formData.append('hourlyLimit', fields.hourlyLimit);
        formData.append('recipients', selectedFile, selectedFile.name);
        await createJobWithCsv(formData);
      } else {
        // JSON body with parsed email list
        const input: CreateJobInput = {
          subject: fields.subject,
          body: fields.body,
          senderEmail: fields.senderEmail,
          senderName: fields.senderName || undefined,
          scheduledAt: new Date(fields.scheduledAt).toISOString(),
          delayBetweenEmailsMs: Number(fields.delayBetweenEmailsMs),
          hourlyLimit: Number(fields.hourlyLimit),
          recipients: detectedEmails.map(email => ({ email })),
        };
        await createJob(input);
      }

      toast.success(`✅ ${detectedEmails.length} emails scheduled successfully!`);

      // Reset form
      setFields({
        subject: '',
        body: '',
        senderEmail: '',
        senderName: '',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16),
        delayBetweenEmailsMs: '2000',
        hourlyLimit: '100',
      });
      setPastedEmails('');
      setDetectedEmails([]);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';

      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to schedule emails';
      toast.error(`❌ ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Compose New Email</h2>
        <p className="text-sm text-slate-500 mt-0.5">Schedule a batch email to multiple recipients</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-6" id="compose-form">
        {/* Content */}
        <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Email Content</h3>
          <Input
            label="Subject"
            id="compose-subject"
            value={fields.subject}
            onChange={e => set('subject', e.target.value)}
            placeholder="Enter email subject..."
            error={errors.subject}
          />
          <Textarea
            label="Body"
            id="compose-body"
            value={fields.body}
            onChange={e => set('body', e.target.value)}
            placeholder="Write your email body here... Use {{name}} for personalisation."
            className="min-h-[140px]"
            error={errors.body}
          />
        </section>

        {/* Sender */}
        <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Sender</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Sender Email"
              id="compose-sender-email"
              type="email"
              value={fields.senderEmail}
              onChange={e => set('senderEmail', e.target.value)}
              placeholder="you@example.com"
              error={errors.senderEmail}
            />
            <Input
              label="Sender Name (optional)"
              id="compose-sender-name"
              value={fields.senderName}
              onChange={e => set('senderName', e.target.value)}
              placeholder="Your Name"
            />
          </div>
        </section>

        {/* Recipients */}
        <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Recipients</h3>

          {/* Toggle */}
          <div className="flex gap-2">
            {(['text', 'csv'] as UploadMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                id={`recipient-mode-${mode}`}
                onClick={() => { setUploadMode(mode); setDetectedEmails([]); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  uploadMode === mode
                    ? 'bg-violet-700 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {mode === 'text' ? '📝 Paste Emails' : '📄 Upload CSV'}
              </button>
            ))}
          </div>

          {uploadMode === 'text' ? (
            <div>
              <label htmlFor="paste-emails" className="text-sm font-medium text-slate-300 block mb-1">
                Paste emails (comma, newline, or space separated)
              </label>
              <textarea
                id="paste-emails"
                value={pastedEmails}
                onChange={e => handleTextChange(e.target.value)}
                placeholder={'alice@example.com, bob@example.com\ncharlie@example.com'}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent min-h-[100px] resize-y"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="csv-upload" className="text-sm font-medium text-slate-300 block mb-1">
                Upload CSV file
              </label>
              <input
                ref={fileRef}
                id="csv-upload"
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-900/50 file:text-violet-300 hover:file:bg-violet-900 file:cursor-pointer"
              />
              {selectedFile && (
                <p className="mt-1 text-xs text-slate-500">Selected: {selectedFile.name}</p>
              )}
            </div>
          )}

          {/* Detected count */}
          <div className={`rounded-lg px-4 py-3 text-sm ${
            detectedEmails.length > 0
              ? 'bg-emerald-900/30 border border-emerald-700/50 text-emerald-300'
              : 'bg-slate-800 border border-slate-700 text-slate-500'
          }`}>
            {detectedEmails.length > 0
              ? `✓ ${detectedEmails.length} unique email address${detectedEmails.length === 1 ? '' : 'es'} detected`
              : 'No email addresses detected yet'}
          </div>
          {errors.recipients && (
            <p className="text-xs text-red-400">{errors.recipients}</p>
          )}
        </section>

        {/* Schedule settings */}
        <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Schedule Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <Input
                label="Start Time"
                id="compose-scheduled-at"
                type="datetime-local"
                value={fields.scheduledAt}
                onChange={e => set('scheduledAt', e.target.value)}
                error={errors.scheduledAt}
              />
            </div>
            <Input
              label="Delay Between Emails (ms)"
              id="compose-delay"
              type="number"
              min="0"
              value={fields.delayBetweenEmailsMs}
              onChange={e => set('delayBetweenEmailsMs', e.target.value)}
              hint="Minimum milliseconds between sends (e.g. 2000 = 2 seconds)"
              error={errors.delayBetweenEmailsMs}
            />
            <Input
              label="Hourly Limit"
              id="compose-hourly-limit"
              type="number"
              min="1"
              value={fields.hourlyLimit}
              onChange={e => set('hourlyLimit', e.target.value)}
              hint="Max emails sent per hour"
              error={errors.hourlyLimit}
            />
          </div>
        </section>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {detectedEmails.length > 0
              ? `${detectedEmails.length} recipients ready`
              : 'Add recipients above to continue'}
          </p>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={detectedEmails.length === 0}
            id="submit-compose-btn"
            className="px-6"
          >
            Schedule Emails
          </Button>
        </div>
      </form>
    </div>
  );
}
