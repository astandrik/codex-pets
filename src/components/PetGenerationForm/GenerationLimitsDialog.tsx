"use client";

import { useRef, useState } from "react";
import { Button, Dialog } from "@gravity-ui/uikit";
import { GENERATION_EXPERIMENT_NOTICE } from "@/lib/pets/generation/disclosure";
import { withBasePath } from "@/lib/base-path";
import "./GenerationLimitsDialog.scss";

export function GenerationLimitsDialog({ open, onClose, reviewBase }: {
  open: boolean;
  onClose: () => void;
  reviewBase: boolean;
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
      <ul>
        <li>Up to 200 accepted tasks per day and 10 per IP, resetting at midnight Moscow time.</li>
        <li>One pet at a time. Up to five tasks may wait for up to 30 minutes.</li>
        <li>Accepted tasks count toward the limit even if generation fails or the result is unsuitable.</li>
        <li>Your result is private for 24 hours from task acceptance, including time in the queue.</li>
      </ul>
      {reviewBase && <p>First, review your character. Animations start only after you confirm it. Creating another character uses a new attempt; confirmation does not.</p>}
      {full && <>
        <h3>Experimental generation</h3>
        <p>{GENERATION_EXPERIMENT_NOTICE}</p>
        <p>After the images are ready, one additional AI request chooses a name if left blank and prepares a description and tags. You can edit and save them before moderation.</p>
        <h3>Your reference and private result</h3>
        <p>Your description and optional PNG, JPEG or WebP reference are sent to the AI service when you submit. The reference is stored privately for up to 24 hours; the original is not published.</p>
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
