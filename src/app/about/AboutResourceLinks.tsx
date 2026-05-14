"use client";

import { Box, LogoGithub } from "@gravity-ui/icons";
import { Button } from "@/components/GravityUI/GravityUI";
import { trackGoal } from "@/lib/metrics/yandex";

type AboutResourceLinksProps = {
  githubUrl: string;
  npmPackageUrl: string;
};

export function AboutResourceLinks({
  githubUrl,
  npmPackageUrl,
}: AboutResourceLinksProps) {
  return (
    <>
      <Button
        view="outlined"
        size="l"
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          trackGoal("about_github_repository_click", {
            location: "about_hero",
          });
        }}
      >
        <LogoGithub />
        GitHub
      </Button>
      <Button
        view="outlined"
        size="l"
        href={npmPackageUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          trackGoal("about_npm_package_click", {
            location: "about_hero",
          });
        }}
      >
        <Box />
        npm package
      </Button>
    </>
  );
}
