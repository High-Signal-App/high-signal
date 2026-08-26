import { permanentRedirect } from 'next/navigation';

export default function BriefArchiveCompatibilityRoute() {
  permanentRedirect('/signals');
}
