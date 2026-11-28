import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url));

function pngChunk(asset: Buffer, name: string) {
  for (let offset = 8; offset + 12 <= asset.length;) {
    const size = asset.readUInt32BE(offset);
    if (asset.toString("ascii", offset + 4, offset + 8) === name) {
      return asset.subarray(offset + 8, offset + 8 + size);
    }
    offset += size + 12;
  }
  throw new Error(`Missing PNG chunk: ${name}`);
}

it("uses the sidebar blue for every alpha level of the app and journal logos", () => {
  const hex = read("../visual-system-pearl.css").toString()
    .match(/--pm-d-selected-ink:#([0-9a-f]{6});/)?.[1];
  expect(hex).toBe("1a49b7");
  const rgb = Buffer.from(hex!, "hex");
  const expectedPalette = Buffer.concat(Array.from({ length: 256 }, () => rgb));
  for (const logo of ["../assets/pm-logo.png", "../assets/journal/export/pm-logo-512.png"]) {
    expect(pngChunk(read(logo), "PLTE")).toEqual(expectedPalette);
    expect(pngChunk(read(logo), "tRNS")).toEqual(Buffer.from(Array.from({ length: 256 }, (_, alpha) => alpha)));
  }
});

it("uses the same blue mark on light browser and home-screen icons", () => {
  const blue = Buffer.from("1a49b7", "hex");
  const light = Buffer.from("f0f6ff", "hex");
  for (const file of ["favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png",
    "android-chrome-192x192.png", "android-chrome-512x512.png", "mstile-150x150.png", "pm-logo.png"]) {
    const palette = pngChunk(read(`../../public/${file}`), "PLTE");
    expect(palette.subarray(0, 3)).toEqual(light);
    expect(palette.subarray(255 * 3, 256 * 3)).toEqual(blue);
  }
  const embedded = read("../../public/favicon.svg").toString()
    .match(/data:image\/png;base64,([^"]+)/)?.[1];
  expect(Buffer.from(embedded!, "base64")).toEqual(read("../../public/android-chrome-512x512.png"));
});
