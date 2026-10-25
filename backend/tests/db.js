import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { Alert } from '../src/models/Alert.js';
import { Batch } from '../src/models/Batch.js';

/** In-memory MongoDB for a test file. Indexes are built before tests run (unique index matters). */
export function useTestDb() {
  let server;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all([Alert.init(), Batch.init()]);
  });
  afterEach(async () => {
    await Promise.all([Alert.deleteMany({}), Batch.deleteMany({})]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });
}
