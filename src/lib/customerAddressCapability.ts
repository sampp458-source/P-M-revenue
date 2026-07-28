interface SupabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function isMissingCustomerAddressColumn(
  error: SupabaseErrorLike | null | undefined,
) {
  if (!error) return false;

  const description = [
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en");

  return (
    description.includes("address") &&
    (error.code === "42703" ||
      error.code === "PGRST204" ||
      description.includes("does not exist") ||
      description.includes("schema cache"))
  );
}
