"use client";

import { useState, type ReactNode } from "react";
import { Button, Dialog } from "@gravity-ui/uikit";
import { StatePreview } from "@/components/StatePreview/StatePreview";
import "./GeneratedPetResult.scss";

type GeneratedPetResultProps = {
  ready?: boolean;
  petJsonUrl: string;
  spritesheetUrl: string;
  downloads: ReactNode;
  metadataEditor?: ReactNode;
  animationEditor: ReactNode;
  publicationForm: ReactNode;
  generationDetails?: ReactNode;
  metadataBlocked: boolean;
  metadataConflict: boolean;
  submitted: boolean;
};

export function GeneratedPetResult(props: GeneratedPetResultProps) {
  const [openPanel, setOpenPanel] = useState<"metadata" | "publication" | "details" | null>(null);
  const ready = props.ready ?? true;
  const close = () => setOpenPanel(null);
  return <div className={ready ? "generated-pet-result" : undefined}>
    <StatePreview petJsonUrl={props.petJsonUrl} spritesheetUrl={props.spritesheetUrl} layout="generation" active={ready} slots={{
      afterStage: <div className="generated-pet-result__download">{props.downloads}</div>,
      sidePanel: <>
        {ready && props.metadataEditor && <button type="button" className="generated-pet-result__panel-trigger" onClick={() => setOpenPanel("metadata")}>
          <span>Name, description &amp; tags<small>{props.metadataConflict ? "Reload the saved details to resolve the conflict" : props.metadataBlocked ? "Save your changes to enable downloads and submission" : "Edit the details included in your pet pack"}</small></span><span aria-hidden="true">›</span>
        </button>}
        {props.animationEditor}
        {ready && <section className="generated-pet-result__share">
          <h2>Share in the gallery</h2>
          <p>{props.submitted ? "Sent for review. Your gallery copy has been saved." : "Optional. Choose an address and submit your pet for moderation."}</p>
          <Button type="button" view="outlined" size="l" width="max" onClick={() => setOpenPanel("publication")}>{props.submitted ? "View gallery submission" : "Prepare gallery submission"}</Button>
        </section>}
      </>,
      afterControls: props.generationDetails && <button type="button" className="generated-pet-result__panel-trigger" onClick={() => setOpenPanel("details")}><span>Generation details<small>Movement instructions, revision history and source</small></span><span aria-hidden="true">›</span></button>,
    }} />
    <Dialog open={ready && openPanel === "metadata"} onClose={close} disableBodyScrollLock={!ready || openPanel !== "metadata"} keepMounted returnFocus contentOverflow="auto" size="m" className="generated-pet-result__dialog" aria-label="Pet details">
      <Dialog.Header caption="Name, description & tags" />
      <Dialog.Body>{props.metadataEditor}</Dialog.Body>
      <Dialog.Footer><Button type="button" aria-label="Close metadata panel" onClick={close}>Close</Button></Dialog.Footer>
    </Dialog>
    <Dialog open={ready && openPanel === "publication"} onClose={close} disableBodyScrollLock={!ready || openPanel !== "publication"} keepMounted returnFocus contentOverflow="auto" size="m" className="generated-pet-result__dialog" aria-label="Gallery submission">
      <Dialog.Header caption="Gallery submission" />
      <Dialog.Body>{props.publicationForm}</Dialog.Body>
      <Dialog.Footer><Button type="button" aria-label="Close publication panel" onClick={close}>Close</Button></Dialog.Footer>
    </Dialog>
    <Dialog open={ready && openPanel === "details"} onClose={close} disableBodyScrollLock={!ready || openPanel !== "details"} keepMounted returnFocus contentOverflow="auto" size="m" className="generated-pet-result__dialog" aria-label="Generation details">
      <Dialog.Header caption="Generation details" />
      <Dialog.Body>{props.generationDetails}</Dialog.Body>
      <Dialog.Footer><Button type="button" aria-label="Close details panel" onClick={close}>Close</Button></Dialog.Footer>
    </Dialog>
  </div>;
}
