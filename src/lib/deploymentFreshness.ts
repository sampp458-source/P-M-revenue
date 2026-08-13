const moduleScriptPath = (documentValue: Document) => {
  const script = documentValue.querySelector<HTMLScriptElement>(
    'script[type="module"][src^="/assets/"]',
  );
  return script?.getAttribute("src") ?? null;
};

export const deploymentModuleScriptPath = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return moduleScriptPath(parsed);
};

export async function reloadWhenDeploymentChanges({
  documentValue = document,
  fetchValue = fetch,
  reload = () => window.location.reload(),
}: {
  documentValue?: Document;
  fetchValue?: typeof fetch;
  reload?: () => void;
} = {}) {
  const currentScript = moduleScriptPath(documentValue);
  if (!currentScript) return false;

  try {
    const response = await fetchValue(`/?deployment-check=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const latestScript = deploymentModuleScriptPath(await response.text());
    if (!latestScript || latestScript === currentScript) return false;
    reload();
    return true;
  } catch {
    return false;
  }
}

export function startDeploymentFreshnessMonitor() {
  let checking = false;
  const check = () => {
    if (checking) return;
    checking = true;
    void reloadWhenDeploymentChanges().finally(() => {
      checking = false;
    });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") check();
  };

  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
