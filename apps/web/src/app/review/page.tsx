import { requireAdminSession } from '@/lib/admin-guard';
import ReviewClient from './ReviewClient';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  await requireAdminSession();
  return <ReviewClient />;
}
