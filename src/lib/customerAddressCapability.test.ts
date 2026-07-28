import { describe, expect, it } from "vitest";
import { isMissingCustomerAddressColumn } from "./customerAddressCapability";

describe("customer address schema compatibility", () => {
  it("recognizes a missing address column from Postgres", () => {
    expect(
      isMissingCustomerAddressColumn({
        code: "42703",
        message: 'column customers.address does not exist',
      }),
    ).toBe(true);
  });

  it("recognizes a stale PostgREST schema cache", () => {
    expect(
      isMissingCustomerAddressColumn({
        code: "PGRST204",
        message:
          "Could not find the 'address' column of 'customers' in the schema cache",
      }),
    ).toBe(true);
  });

  it("does not hide unrelated permission or network failures", () => {
    expect(
      isMissingCustomerAddressColumn({
        code: "42501",
        message: "permission denied for table customers",
      }),
    ).toBe(false);
  });
});
