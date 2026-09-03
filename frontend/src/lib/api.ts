// ──────────────────────────────────────────────────────────────────────────────
// API Client — all backend calls go through here
// Credentials: 'include' so session cookies are sent with every request.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  User,
  EmailJob,
  Email,
  ApiResponse,
  PaginatedResponse,
  CreateJobInput,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include', // send session cookie
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? `HTTP ${res.status}`,
    );
  }

  return json as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getMe(): Promise<User> {
  const res = await request<ApiResponse<{ user: User }>>('/api/auth/me');
  return res.data.user;
}

export function getGoogleLoginUrl(): string {
  return `${BASE_URL}/api/auth/google`;
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'DELETE' });
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function getJobs(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<PaginatedResponse<EmailJob>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.status) query.set('status', params.status);

  return request<PaginatedResponse<EmailJob>>(`/api/jobs?${query.toString()}`);
}

export async function getJob(id: string): Promise<ApiResponse<{ job: EmailJob; emails: Email[] }>> {
  return request<ApiResponse<{ job: EmailJob; emails: Email[] }>>(`/api/jobs/${id}`);
}

export async function createJob(input: CreateJobInput): Promise<ApiResponse<{ job: EmailJob }>> {
  return request<ApiResponse<{ job: EmailJob }>>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createJobWithCsv(formData: FormData): Promise<ApiResponse<{ job: EmailJob }>> {
  const res = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    credentials: 'include',
    // No Content-Type header — browser sets multipart/form-data boundary
    body: formData,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return json;
}

export async function cancelJob(id: string): Promise<void> {
  await request(`/api/jobs/${id}`, { method: 'DELETE' });
}

// ── Emails ────────────────────────────────────────────────────────────────────

export async function getScheduledEmails(params?: {
  page?: number;
  pageSize?: number;
  jobId?: string;
}): Promise<PaginatedResponse<Email>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.jobId) query.set('jobId', params.jobId);

  return request<PaginatedResponse<Email>>(`/api/emails/scheduled?${query.toString()}`);
}

export async function getSentEmails(params?: {
  page?: number;
  pageSize?: number;
  jobId?: string;
}): Promise<PaginatedResponse<Email>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.jobId) query.set('jobId', params.jobId);

  return request<PaginatedResponse<Email>>(`/api/emails/sent?${query.toString()}`);
}

type SearchEmailHit = Email & { emailId?: string };

export async function searchEmails(params?: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<Email>> {
  const query = new URLSearchParams();
  if (params?.q) query.set('q', params.q);
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));

  const res = await request<PaginatedResponse<SearchEmailHit>>(`/api/emails/search?${query.toString()}`);
  
  // Normalize Elasticsearch 'emailId' to standard 'id' for the UI
  if (res.data) {
    res.data = res.data.map((item) => ({
      ...item,
      id: item.id || item.emailId!,
    }));
  }
  
  return res as PaginatedResponse<Email>;
}

export { ApiError };
