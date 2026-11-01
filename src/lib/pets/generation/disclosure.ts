const LEGACY_NOTICE = "Experimental generation: animations and gaze directions may contain visual errors or look too similar. Review the preview before submitting your pet to moderation. Accepted tasks count toward the limit even if the result is unsuitable. A failed image stage may be retried once after a delay, which can incur an additional provider charge.";
export const GENERATION_EXPERIMENT_NOTICE = LEGACY_NOTICE.replace("A failed image stage may be retried once after a delay, which can incur an additional provider charge.", "Image requests may be retried under the saved task policy, which can incur additional provider charges.");
export const ANIMATION_AUTO_REPAIR_NOTICE = "Automatic repair can regenerate a failed animation up to 3 additional times (4 attempts total, including transport retries), within the same task. Saved animations are kept. Extra provider calls count toward the existing shared spending limit, without another daily generation attempt.";
export function generationExperimentNotice(automaticAnimationRepair: boolean) {
  return automaticAnimationRepair ? GENERATION_EXPERIMENT_NOTICE + " " + ANIMATION_AUTO_REPAIR_NOTICE : LEGACY_NOTICE;
}
