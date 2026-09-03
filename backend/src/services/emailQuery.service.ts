import { prisma } from '../config/database';
import { logger } from '../middleware/errorHandler';
import { AppError } from '../middleware/errorHandler';
import { EmailStatus, Prisma } from '@prisma/client';
import { ListEmailsQuery } from '../schemas/job.schema';

// ──────────────────────────────────────────────────────────────────────────────
// Email Query Service
// ──────────────────────────────────────────────────────────────────────────────

export async function listEmails(params: ListEmailsQuery & { userId: string }) {
  const { userId, page, pageSize, status, jobId } = params;
  const skip = (page - 1) * pageSize;

  // Scope emails to jobs owned by this user
  const where: Prisma.EmailWhereInput = {
    job: { userId },
    ...(status ? { status: status as EmailStatus } : {}),
    ...(jobId ? { jobId } : {}),
  };

  const [emails, total] = await Promise.all([
    prisma.email.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        jobId: true,
        recipient: true,
        subject: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        failedAt: true,
        failureReason: true,
        attemptCount: true,
        etherealPreviewUrl: true,
        bullmqJobId: true,
        createdAt: true,
      },
    }),
    prisma.email.count({ where }),
  ]);

  return { emails, total, page, pageSize };
}

export async function getEmailById(emailId: string, userId: string) {
  const email = await prisma.email.findFirst({
    where: { id: emailId, job: { userId } },
    include: {
      job: {
        select: {
          id: true,
          subject: true,
          senderEmail: true,
          senderName: true,
          status: true,
          totalRecipients: true,
          sentCount: true,
          scheduledAt: true,
        },
      },
    },
  });

  if (!email) throw AppError.notFound('Email not found');
  return email;
}
