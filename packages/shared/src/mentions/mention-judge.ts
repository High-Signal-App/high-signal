// Compatibility surface for existing High Signal imports. Provider calls stay
// in the worker adapter; prompt construction and verdict parsing are shared.
export {
  buildMentionJudgePrompt,
  extractJsonObject,
  parseMentionVerdict,
  type BrandSubject as JudgeSubject,
  type MentionAnalysis as MentionVerdict,
} from '@saas-maker/ai-visibility';
