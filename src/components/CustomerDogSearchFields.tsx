import { Dog, UserRound } from "lucide-react";
import { formatPhoneForDisplay } from "../lib/phone";
import { operationDogProfileLine } from "../pages/operationsScheduleRepository";
import { SearchSelect } from "./SearchSelect";

export interface CustomerSearchOption {
  id: string;
  name: string | null;
  phone?: string | null;
}

export interface DogSearchOption {
  id: string;
  name: string;
  customerId?: string | null;
  breed?: string | null;
  sex?: "male" | "female" | null;
}

export function CustomerDogSearchFields({
  customers,
  dogs,
  canonicalDogs,
  customerIds,
  dogIds,
  onCustomerIdsChange,
  onDogIdsChange,
  multiple = false,
  customerFirst = false,
  dogMultiple = multiple,
  customerMultiple = multiple,
  disabled = false,
  recentScope,
}: {
  customers: readonly CustomerSearchOption[];
  dogs: readonly DogSearchOption[];
  canonicalDogs?: readonly DogSearchOption[];
  customerIds: readonly string[];
  dogIds: readonly string[];
  onCustomerIdsChange: (ids: string[]) => void;
  onDogIdsChange: (ids: string[]) => void;
  multiple?: boolean;
  customerFirst?: boolean;
  dogMultiple?: boolean;
  customerMultiple?: boolean;
  disabled?: boolean;
  recentScope: string;
}) {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const dogsByCustomer = new Map<string, string[]>();
  (canonicalDogs ?? dogs).forEach((dog) => {
    if (!dog.customerId) return;
    dogsByCustomer.set(dog.customerId, [
      ...(dogsByCustomer.get(dog.customerId) ?? []),
      dog.name,
    ]);
  });

  const dogField = (
      <SearchSelect
        label="반려견"
        required
        items={dogs}
        selectedIds={dogIds}
        onChange={onDogIdsChange}
        multiple={dogMultiple}
        disabled={disabled}
        getItemId={(row) => row.id}
        getSearchText={(row) => {
          const customer = customerById.get(row.customerId ?? "");
          return `${row.name} ${customer?.name ?? ""} ${customer?.phone ?? ""}`;
        }}
        renderOption={(row) => {
          const customer = customerById.get(row.customerId ?? "");
          const ownerLine = [
            customer?.name?.trim() || "",
            formatPhoneForDisplay(customer?.phone),
          ].filter(Boolean).join(" · ");
          return (
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Dog size={18} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm text-text-primary">{row.name}</strong>
                {operationDogProfileLine(row) ? (
                  <span className="mt-0.5 block truncate text-xs text-text-secondary">
                    {operationDogProfileLine(row)}
                  </span>
                ) : null}
                {ownerLine ? (
                  <span className="mt-0.5 block truncate text-xs text-text-muted">{ownerLine}</span>
                ) : null}
              </span>
            </span>
          );
        }}
        renderSelected={(row) => (
          <span className="inline-flex items-center gap-1.5">
            <Dog aria-hidden="true" size={14} />
            {row.name}
          </span>
        )}
        placeholder="반려견, 보호자 또는 전화번호 검색"
        emptyMessage="최근 선택한 반려견이 없습니다."
        recentStorageKey={`pm-os:${recentScope}:dogs`}
      />
  );
  const customerField = (
      <SearchSelect
        label="보호자"
        required
        items={customers}
        selectedIds={customerIds}
        onChange={onCustomerIdsChange}
        multiple={customerMultiple}
        disabled={disabled}
        getItemId={(row) => row.id}
        getSearchText={(row) =>
          `${row.name ?? ""} ${row.phone ?? ""} ${(dogsByCustomer.get(row.id) ?? []).join(" ")}`
        }
        renderOption={(row) => (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <UserRound size={18} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm text-text-primary">
                {row.name || "이름 미등록"}
              </strong>
              <span className="mt-0.5 block truncate text-xs text-text-muted">
                {(dogsByCustomer.get(row.id) ?? []).join(", ") || "연결된 반려견 없음"}
                {" · "}{formatPhoneForDisplay(row.phone) || "전화번호 미등록"}
              </span>
            </span>
          </span>
        )}
        renderSelected={(row) => row.name || "이름 미등록"}
        placeholder="보호자, 전화번호 또는 반려견 검색"
        emptyMessage="최근 선택한 보호자가 없습니다."
        recentStorageKey={`pm-os:${recentScope}:customers`}
      />
  );

  return (
    <>
      {customerFirst ? customerField : dogField}
      {customerFirst ? dogField : customerField}
    </>
  );
}
