import { Queue } from 'bullmq';
import IORedis from 'ioredis';
const globalForQueue = globalThis as unknown as { queue?: Queue; redis?: IORedis };
export const redis = globalForQueue.redis ?? new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
export const queue = globalForQueue.queue ?? new Queue('clipper', { connection: redis, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 } });
if (process.env.NODE_ENV !== 'production') { globalForQueue.redis = redis; globalForQueue.queue = queue; }
