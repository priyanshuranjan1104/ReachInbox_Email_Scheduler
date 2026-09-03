import { esClient, ES_INDICES } from '../src/config/elasticsearch';
import { syncEmailToElasticsearch, searchEmails, bulkSyncEmails } from '../src/services/search.service';
import { prisma } from '../src/config/database';

jest.mock('../src/config/elasticsearch', () => {
  const mEsClient = {
    index: jest.fn().mockResolvedValue({}),
    bulk: jest.fn().mockResolvedValue({ errors: false, items: [] }),
    search: jest.fn().mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              emailId: 'test-email-id',
              subject: 'Test Subject',
              recipient: 'test@example.com',
            },
          },
        ],
      },
    }),
  };
  return { esClient: mEsClient, ES_INDICES: { EMAILS: 'emails' } };
});

jest.mock('../src/config/database', () => {
  return {
    prisma: {
      email: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'test-email-id',
          jobId: 'test-job-id',
          recipient: 'test@example.com',
          status: 'SENT',
          scheduledAt: new Date('2023-01-01T00:00:00Z'),
          sentAt: new Date('2023-01-01T00:01:00Z'),
          createdAt: new Date('2023-01-01T00:00:00Z'),
          idempotencyKey: 'test-key',
          job: {
            userId: 'test-user',
            senderEmail: 'sender@example.com',
            subject: 'Test Subject',
            body: 'Test Body',
          },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'test-email-id',
            jobId: 'test-job-id',
            recipient: 'test@example.com',
            status: 'SENT',
            scheduledAt: new Date('2023-01-01T00:00:00Z'),
            sentAt: new Date('2023-01-01T00:01:00Z'),
            createdAt: new Date('2023-01-01T00:00:00Z'),
            idempotencyKey: 'test-key',
            job: {
              userId: 'test-user',
              senderEmail: 'sender@example.com',
              subject: 'Test Subject',
              body: 'Test Body',
            },
          },
        ]),
      },
    },
  };
});

describe('Search Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch from database and index a single email', async () => {
    await syncEmailToElasticsearch('test-email-id');

    expect(prisma.email.findUnique).toHaveBeenCalledWith({
      where: { id: 'test-email-id' },
      include: expect.any(Object),
    });

    expect(esClient.index).toHaveBeenCalledWith({
      index: ES_INDICES.EMAILS,
      id: 'test-email-id',
      document: expect.objectContaining({
        emailId: 'test-email-id',
        jobId: 'test-job-id',
        recipient: 'test@example.com',
        sender: 'sender@example.com',
        subject: 'Test Subject',
        status: 'SENT',
      }),
    });
  });

  it('should handle missing emails gracefully', async () => {
    (prisma.email.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await syncEmailToElasticsearch('missing-id');

    expect(esClient.index).not.toHaveBeenCalled();
  });

  it('should bulk index emails', async () => {
    await bulkSyncEmails(['test-email-id']);

    expect(prisma.email.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['test-email-id'] } },
      include: expect.any(Object),
    });

    expect(esClient.bulk).toHaveBeenCalled();
    const mockCall = (esClient.bulk as jest.Mock).mock.calls[0][0];
    expect(mockCall.operations).toHaveLength(2); // Action + Document
    expect(mockCall.operations[0]).toEqual({ index: { _index: ES_INDICES.EMAILS, _id: 'test-email-id' } });
    expect(mockCall.operations[1]).toMatchObject({ subject: 'Test Subject' });
  });

  it('should search emails with user isolation', async () => {
    const result = await searchEmails({
      query: 'Test',
      userId: 'test-user',
      status: 'SENT',
    });

    expect(result.hits).toHaveLength(1);
    expect(result.total).toBe(1);

    expect(esClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          bool: expect.objectContaining({
            must: expect.arrayContaining([
              { term: { userId: 'test-user' } },
              { term: { status: 'SENT' } },
              {
                multi_match: expect.objectContaining({
                  query: 'Test',
                }),
              },
            ]),
          }),
        }),
      })
    );
  });
});
