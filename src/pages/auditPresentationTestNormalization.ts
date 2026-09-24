// Normalize only the explicit Phase3 presentation deltas, then retain the original full-source hashes.
// Validation, focus, session, request and navigation bytes are not excluded.
export function normalizeAuditPresentation(source: string) {
  let result = source.replace("function SignupError({ message }: { message: string }) {\n  return <div id=\"signup-error\" role=\"alert\" className=\"flex items-start gap-2 rounded-xl border border-red-300/30 bg-red-950/35 px-3.5 py-3 text-sm leading-5 text-red-100\">\n    <AlertCircle className=\"mt-0.5 shrink-0\" size={17} />\n    <span>{message}</span>\n  </div>;\n}\n\n", '')
    .replace('<p className="account-brand">P&amp;M OS</p>', '');
  for (const field of ['name', 'phone', 'email', 'password', 'confirmPassword']) {
    result = result.replace(`              {error && errorField === "${field}" && <SignupError message={error} />}\n`, '');
  }
  return result.replace('              {error && !errorField && <SignupError message={error} />}', "              {error && (\n                <div\n                  id=\"signup-error\"\n                  role=\"alert\"\n                  className=\"flex items-start gap-2 rounded-xl border border-red-300/30 bg-red-950/35 px-3.5 py-3 text-sm leading-5 text-red-100\"\n                >\n                  <AlertCircle className=\"mt-0.5 shrink-0\" size={17} />\n                  <span>{error}</span>\n                </div>\n              )}");
}
