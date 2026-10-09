import { permanentRedirect } from 'next/navigation';

export const revalidate = 600;
export default function BriefCompatibilityRoute() {
  permanentRedirect('/');
}
