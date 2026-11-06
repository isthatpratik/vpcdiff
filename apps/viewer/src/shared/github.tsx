import { REPO } from "./brand.tsx";
import githubMono from "../logos/github-icon-mono.svg?raw";

/** The GitHub mark (Simple Icons, CC0) linking to the repository. */
export function GithubLink() {
  return (
    <a
      href={REPO}
      target="_blank"
      rel="noreferrer"
      aria-label="vpcdiff on GitHub"
      className="inline-flex size-8 items-center justify-center rounded-litt-control text-litt-fg-muted transition-colors duration-200 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-4 [&_svg]:fill-current"
      dangerouslySetInnerHTML={{ __html: githubMono }}
    />
  );
}
