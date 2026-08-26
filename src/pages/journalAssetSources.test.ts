import { describe, expect, it } from "vitest";
import { JOURNAL_BUNDLED_ASSET_SOURCES, JOURNAL_CANVAS_ASSET_SOURCES } from "./journalAssetSources";
import { JOURNAL_REQUIRED_ASSET_IDS } from "./journalRenderContract";

describe("Journal bundled asset source contract", () => {
  it("maps all seven approved illustrations and the official logo to bundled PNG assets", () => {
    expect(Object.keys(JOURNAL_BUNDLED_ASSET_SOURCES).sort()).toEqual([...JOURNAL_REQUIRED_ASSET_IDS, "official-logo"].sort());
    Object.values(JOURNAL_BUNDLED_ASSET_SOURCES).forEach((source) => expect(source).toMatch(/\.png(?:\?|$)/));
  });

  it("keeps the Production preview logo source while Canvas uses the 512px transparent derivative", () => {
    expect(JOURNAL_CANVAS_ASSET_SOURCES["official-logo"]).not.toBe(JOURNAL_BUNDLED_ASSET_SOURCES["official-logo"]);
    expect(JOURNAL_CANVAS_ASSET_SOURCES["official-logo"]).toMatch(/pm-logo-512\.png(?:\?|$)/);
  });
});
