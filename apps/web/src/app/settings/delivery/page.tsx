import { requireSignedIn } from '@/lib/require-auth';
import SettingsDeliveryClient from './SettingsDeliveryClient';

export const dynamic = 'force-dynamic';

export default async function SettingsDeliveryPage() {
  await requireSignedIn();
  return <SettingsDeliveryClient />;
}
