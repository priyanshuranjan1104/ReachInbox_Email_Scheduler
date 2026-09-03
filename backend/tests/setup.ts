// Test environment setup
// Sets required env vars before any test runs

process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3002';
process.env['SESSION_SECRET'] = 'test-secret-that-is-at-least-32-characters-long!!';
process.env['DATABASE_URL'] = 'postgresql://reachinbox:changeme@localhost:5433/reachinbox_db?schema=public';
process.env['REDIS_HOST'] = 'localhost';
process.env['REDIS_PORT'] = '6379';
process.env['REDIS_PASSWORD'] = 'changeme';
process.env['ELASTICSEARCH_URL'] = 'http://localhost:9200';
process.env['FRONTEND_URL'] = 'http://localhost:3000';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['WORKER_CONCURRENCY'] = '2';
process.env['API_BASE_URL'] = 'http://localhost:3002';
