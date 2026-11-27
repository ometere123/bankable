import { loadProfiles, PROFILE_MANIFESTS } from "@bankable/core";
export { makeDual } from "./dual";

/** Renderer profiles pull in the PDF renderer; import this module only on pages that issue or verify files. */
export const profiles = loadProfiles(PROFILE_MANIFESTS);
/** The profile this build issues with: the newest committed manifest. */
export const currentProfile = [...profiles.values()].at(-1)!;
