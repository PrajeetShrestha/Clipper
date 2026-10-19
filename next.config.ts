import type { NextConfig } from 'next';
const nextConfig: NextConfig = { poweredByHeader: false, serverExternalPackages: ['bullmq', 'ioredis'] };
export default nextConfig;
