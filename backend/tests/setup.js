// Test env is set here explicitly; tests never load backend/.env.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/api-monitor-test';
process.env.GEMINI_MODEL ??= 'test-model';
