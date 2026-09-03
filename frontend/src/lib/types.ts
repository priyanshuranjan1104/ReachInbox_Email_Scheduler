// ──────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the ReachInbox frontend
// ──────────────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
};

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export type EmailStatus =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'RATE_LIMITED'
  | 'RESCHEDULED'
  | 'CANCELLED';

export type EmailJob = {
  id: string;
  userId: string;
  subject: string;
  body: string;
  senderEmail: string;
  senderName: string | null;
  scheduledAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  rescheduledCount: number;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Email = {
  id: string;
  jobId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  idempotencyKey: string;
  bullmqJobId: string | null;
  etherealPreviewUrl: string | null;
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResponse<T> = {
  success: true;
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type ApiResponse<T> = {
  success: true;
  data: T;
  message?: string;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type CreateJobInput = {
  subject: string;
  body: string;
  senderEmail: string;
  senderName?: string;
  scheduledAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  recipients: Array<{ email: string; name?: string }>;
};
