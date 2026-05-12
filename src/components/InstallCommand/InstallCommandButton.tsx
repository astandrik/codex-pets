"use client";

import { useState } from "react";
import { Button } from "@/components/GravityUI/GravityUI";
import { Check, Copy, TerminalLine } from "@gravity-ui/icons";

import { trackGoal } from "@/lib/metrics/yandex";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import "./InstallCommandButton.scss";

type InstallCommandButtonProps = {
  slug: string;
  surface: "card" | "detail";
};

export function InstallCommandButton({
  slug,
  surface,
}: InstallCommandButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const command = buildPetInstallCommand(slug);
  const buttonText = getButtonText(status);

  async function handleCopy() {
    try {
      await copyText(command);
      setStatus("copied");
      trackGoal("pet_install_command_copy", {
        slug,
        surface,
      });
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2200);
    }
  }

  return (
    <div className={`install-command install-command_${surface}`}>
      <TerminalLine width={16} height={16} className="install-command__icon" />
      {surface === "card" ? (
        <code className="install-command__code" title={command}>
          <span className="install-command__prefix">install</span>{" "}
          <span className="install-command__slug">{slug}</span>
        </code>
      ) : (
        <code className="install-command__code">{command}</code>
      )}
      <Button
        view="flat"
        size="s"
        onClick={handleCopy}
        aria-label={`Copy install command for ${slug}`}
        title="Copy install command"
        className="install-command__button"
      >
        {status === "copied" ? (
          <Check width={16} height={16} />
        ) : (
          <Copy width={16} height={16} />
        )}
        <span className="install-command__button-text">{buttonText}</span>
      </Button>
    </div>
  );
}

function getButtonText(status: "idle" | "copied" | "error"): string {
  if (status === "copied") return "Copied";
  if (status === "error") return "Failed";
  return "Copy";
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy_failed");
    }
  } finally {
    textarea.remove();
  }
}
