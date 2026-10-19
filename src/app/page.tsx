import { authorized } from '@/lib/auth';
import App from './ui';
export default async function Home() { return <App initialAuth={await authorized()} />; }
