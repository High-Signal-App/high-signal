import { requireSignedIn } from '@/lib/require-auth';
import EntityWatchlistClient from './EntityWatchlistClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Watched entities' };

export default async function EntityWatchlistPage() {
  await requireSignedIn();
  return <EntityWatchlistClient />;
}
