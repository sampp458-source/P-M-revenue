import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primitives = readFileSync(
  new URL("./profile.tsx", import.meta.url),
  "utf8",
);
const dogProfile = readFileSync(
  new URL("../pages/DogProfileModal.tsx", import.meta.url),
  "utf8",
);
const designSystem = readFileSync(
  new URL("../../docs/ux-design-system.md", import.meta.url),
  "utf8",
);

describe("P&M OS profile design system", () => {
  it("provides one shared profile structure", () => {
    [
      "ProfileContent",
      "ProfileHeader",
      "ProfileSection",
      "ProfileInfoGrid",
      "ProfileField",
      "ProfileTimeline",
      "ProfileTimelineItem",
      "ProfileHistory",
    ].forEach((name) => expect(primitives).toContain(`function ${name}`));
  });

  it("uses shared profile primitives in the Dog Profile", () => {
    expect(dogProfile).toContain("<ProfileHeader");
    expect(dogProfile).toContain("<ProfileSection");
    expect(dogProfile).toContain("<ProfileInfoGrid");
    expect(dogProfile).toContain("<ProfileTimeline");
    expect(dogProfile).not.toContain("function ProfileField");
  });

  it("documents read-first, Master and lazy-loading contracts", () => {
    expect(designSystem).toContain("List → Profile → Local edit");
    expect(designSystem).toContain("Profiles are read-first");
    expect(designSystem).toContain(
      "Never create a screen-specific copy of Master data",
    );
    expect(designSystem).toContain(
      "Fetch Timeline and History lazily by entity ID",
    );
    expect(designSystem).toContain(
      "Finance calculations and snapshots are unchanged",
    );
  });
});
