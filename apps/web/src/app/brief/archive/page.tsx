import { permanentRedirect } from 'next/navigation';

export const revalidate = 3600;
export default function BriefArchiveCompatibilityRoute() {
  permanentRedirect('/signals');
}
