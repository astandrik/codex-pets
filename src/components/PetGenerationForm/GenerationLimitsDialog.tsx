"use client";

import { useRef, useState } from "react";
import { Button, Dialog } from "@gravity-ui/uikit";
import {DEFAULT_GENERATION_QUEUE_LIMIT} from "@/lib/pets/generation/queue-policy";
import {DEFAULT_DAILY_QUOTA_LIMITS, type GenerationDailyQuotaLimits} from "@/lib/pets/generation/quota-limits";
import { ANIMATION_AUTO_REPAIR_NOTICE, generationExperimentNotice } from "@/lib/pets/generation/disclosure";
import { withBasePath } from "@/lib/base-path";
import "./GenerationLimitsDialog.scss";

export function GenerationLimitsDialog({ open, onClose, reviewBase, automaticAnimationRepair = false, queueLimit = DEFAULT_GENERATION_QUEUE_LIMIT, dailyQuotaLimits = DEFAULT_DAILY_QUOTA_LIMITS }: {
  open: boolean;
  onClose: () => void;
  reviewBase: boolean;
  automaticAnimationRepair?: boolean;
  queueLimit?: number | null;
  dailyQuotaLimits?: GenerationDailyQuotaLimits | null;
}) {
  const [full, setFull] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  function changeView() {
    setFull(value => !value);
    heading.current?.focus({preventScroll: true});
    body.current?.scrollTo?.({top: 0});
  }
  return <Dialog open={open} onClose={onClose} disableBodyScrollLock={!open} returnFocus keepMounted contentOverflow="auto" size="m" className="generation-limits-dialog" aria-labelledby="generation-limits-title">
    <Dialog.Header caption={<h2 ref={heading} tabIndex={-1} id="generation-limits-title">{full ? "Generation details & privacy" : "Before you create"}</h2>} />
    <div ref={body} className="generation-limits-dialog__body">
      <p>Generation is funded by this service. No account is needed.</p>
      {automaticAnimationRepair && <p>{ANIMATION_AUTO_REPAIR_NOTICE}</p>}
      <ul>
        <li>{dailyQuotaLimits === null
          ? "Daily allowance is temporarily unavailable. Saved requests can still be checked."
          : <>Up to {dailyQuotaLimits.global} accepted tasks per day and {dailyQuotaLimits.ip} per IP, resetting at midnight Moscow time.</>}</li>
        <li>{queueLimit === null
          ? <>Queue capacity is temporarily unavailable. Accepted tasks may wait until their 24-hour lifetime expires.</>
          : <>One pet at a time. Up to {queueLimit} {queueLimit === 1 ? "task" : "tasks"} may wait. Tasks remain queued until they start or their 24-hour lifetime expires.</>}</li>
        <li>Accepted tasks count toward the limit even if generation fails or the result is unsuitable.</li>
        <li>Your task and private files expire 24 hours from task acceptance, including time in the queue.</li>
      </ul>
      {reviewBase && <p>First, review your character. Animations start only after you confirm it. Creating another character uses a new attempt; confirmation does not.</p>}
      {full && <>
        <h3>Experimental generation</h3>
        <p>{generationExperimentNotice(automaticAnimationRepair)}</p>
        <p>After the images are ready, one additional AI request chooses a name if left blank and prepares a description and tags. You can edit and save them before moderation.</p>
        <h3>Your reference and private result</h3>
        <p>Your description and optional PNG, JPEG or WebP reference are sent to the AI service when you submit. The accepted description and normalized reference may be stored privately for up to 24 hours so you can retry a failed character. They are not published.</p>
        <p>Preview and download the package before it expires. Keep the result link private: anyone with the link can access it. The 24-hour period starts when the task is accepted, not when generation finishes.</p>
        <p>Publishing is optional. Choose a gallery address on the result page, then explicitly submit your pet for moderation.</p>
        <p><a href={withBasePath("/guides/ai-pet-generator")}>Read the generation guide</a></p>
      </>}
    </div>
    <Dialog.Footer>
      <Button type="button" onClick={changeView}>{full ? "Short version" : "Full details"}</Button>
      <Button type="button" view="action" onClick={onClose}>Got it</Button>
    </Dialog.Footer>
  </Dialog>;
}
