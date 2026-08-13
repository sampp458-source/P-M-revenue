// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  deploymentModuleScriptPath,
  reloadWhenDeploymentChanges,
} from "./deploymentFreshness";

const page = (script: string) => {
  const documentValue = document.implementation.createHTMLDocument();
  documentValue.body.innerHTML = `<script type="module" src="${script}"></script>`;
  return documentValue;
};

describe("deployment freshness", () => {
  it("extracts the deployed module asset without exposing application data", () => {
    expect(deploymentModuleScriptPath(
      '<script type="module" crossorigin src="/assets/index-new.js"></script>',
    )).toBe("/assets/index-new.js");
  });

  it("reloads a long-lived tab when Netlify publishes a different bundle", async () => {
    const reload = vi.fn();
    const fetchValue = vi.fn().mockResolvedValue(new Response(
      '<script type="module" src="/assets/index-new.js"></script>',
      { status: 200 },
    ));

    await expect(reloadWhenDeploymentChanges({
      documentValue: page("/assets/index-old.js"),
      fetchValue,
      reload,
    })).resolves.toBe(true);

    expect(fetchValue).toHaveBeenCalledWith(
      expect.stringMatching(/^\/\?deployment-check=\d+$/),
      { cache: "no-store", credentials: "same-origin" },
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the current bundle is still published", async () => {
    const reload = vi.fn();
    const fetchValue = vi.fn().mockResolvedValue(new Response(
      '<script type="module" src="/assets/index-current.js"></script>',
      { status: 200 },
    ));

    await expect(reloadWhenDeploymentChanges({
      documentValue: page("/assets/index-current.js"),
      fetchValue,
      reload,
    })).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("fails silently and keeps the current UI when the version check fails", async () => {
    const reload = vi.fn();
    const fetchValue = vi.fn().mockRejectedValue(new Error("network unavailable"));

    await expect(reloadWhenDeploymentChanges({
      documentValue: page("/assets/index-current.js"),
      fetchValue,
      reload,
    })).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
