import { RegionPicker } from './RegionPicker';
import { DailyBriefHeroContent } from './DailyBriefHeroContent';

export function DailyBriefHero(
  props: Omit<Parameters<typeof DailyBriefHeroContent>[0], 'regionPicker'>
) {
  return <DailyBriefHeroContent {...props} regionPicker={<RegionPicker active={props.region} />} />;
}
