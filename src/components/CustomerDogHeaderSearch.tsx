import { Dog, LoaderCircle, Search, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppModule } from "../app/moduleState";
import { formatPhoneForDisplay } from "../lib/phone";
import { supabase } from "../lib/supabase";
import { preferredDogService, type CustomerDogServiceStatus } from "../pages/customerDogArchitecture";
import { loadCurrentCustomerDogServices } from "../pages/customerDogDirectory";
import { DogCurrentService } from "./CustomerDogServiceSummary";

interface SearchCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  active: boolean;
}

interface SearchDog {
  id: string;
  customerId: string | null;
  name: string;
  breed: string | null;
  active: boolean;
}

type SearchResult =
  | { kind: "customer"; customer: SearchCustomer; dogs: SearchDog[] }
  | {
      kind: "dog";
      dog: SearchDog;
      customer: SearchCustomer | null;
      familyContext: boolean;
    };

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .replace(/[\s-]/g, "")
    .toLocaleLowerCase("ko");

export function CustomerDogHeaderSearch({ module }: { module: AppModule }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<SearchCustomer[]>([]);
  const [dogs, setDogs] = useState<SearchDog[]>([]);
  const [services, setServices] = useState<CustomerDogServiceStatus[]>([]);
  const [serviceStatusAvailable, setServiceStatusAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    setError("");
    void Promise.all([
      supabase
        .from("customers")
        .select("id, name, phone, is_active")
        .order("name"),
      supabase
        .from("dogs")
        .select("id, customer_id, name, breed, is_active")
        .order("name"),
      loadCurrentCustomerDogServices().catch(() => ({ services: [], available: false })),
    ]).then(([customerResult, dogResult, serviceResult]) => {
      setLoading(false);
      if (customerResult.error || dogResult.error) {
        setError("고객 검색 정보를 불러오지 못했습니다.");
        return;
      }
      setCustomers(
        (customerResult.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          active: row.is_active,
        })),
      );
      setDogs(
        (dogResult.data ?? []).map((row) => ({
          id: row.id,
          customerId: row.customer_id,
          name: row.name,
          breed: row.breed,
          active: row.is_active,
        })),
      );
      setServices(serviceResult.services);
      setServiceStatusAvailable(serviceResult.available);
      setLoaded(true);
    });
  }, [loaded, loading, open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const mobile = window.matchMedia("(max-width: 639px)").matches;
      (mobile ? mobileInputRef : desktopInputRef).current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const results = useMemo(() => {
    const keyword = normalize(query);
    if (!keyword) return [] as SearchResult[];
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    const dogsByCustomer = new Map<string, SearchDog[]>();
    dogs.forEach((dog) => {
      if (!dog.active || !dog.customerId) return;
      dogsByCustomer.set(dog.customerId, [
        ...(dogsByCustomer.get(dog.customerId) ?? []),
        dog,
      ]);
    });
    const customerResults: SearchResult[] = customers
      .filter(
        (customer) =>
          customer.active &&
          [customer.name, customer.phone].some((value) =>
            normalize(value).includes(keyword),
          ),
      )
      .slice(0, 4)
      .map((customer) => ({
        kind: "customer",
        customer,
        dogs: dogsByCustomer.get(customer.id) ?? [],
      }));
    const matchingDogs = dogs
      .filter((dog) => {
        const customer = dog.customerId
          ? customersById.get(dog.customerId)
          : null;
        return (
          dog.active &&
          [dog.name, dog.breed, customer?.name, customer?.phone].some((value) =>
            normalize(value).includes(keyword),
          )
        );
      })
      .slice(0, 6);
    const directlyMatchedCustomerIds = new Set(
      matchingDogs
        .filter((dog) =>
          [dog.name, dog.breed].some((value) =>
            normalize(value).includes(keyword),
          ),
        )
        .map((dog) => dog.customerId)
        .filter((value): value is string => Boolean(value)),
    );
    const familyDogs = dogs.filter(
      (dog) =>
        dog.active &&
        Boolean(dog.customerId) &&
        directlyMatchedCustomerIds.has(dog.customerId!) &&
        !matchingDogs.some((match) => match.id === dog.id),
    );
    const dogResults: SearchResult[] = [...matchingDogs, ...familyDogs]
      .slice(0, 8)
      .map((dog) => ({
        kind: "dog",
        dog,
        customer: dog.customerId
          ? (customersById.get(dog.customerId) ?? null)
          : null,
        familyContext: familyDogs.some((familyDog) => familyDog.id === dog.id),
      }));
    return [...customerResults, ...dogResults].slice(0, 8);
  }, [customers, dogs, query]);

  const openSearch = () => {
    setOpen(true);
  };
  const go = (result: SearchResult) => {
    const base = module === "operations" ? "/operations" : "";
    if (result.kind === "customer") {
      navigate(
        `${base}/customer-management?customerId=${encodeURIComponent(result.customer.id)}`,
      );
    } else {
      navigate(
        `${base}/customers?dogId=${encodeURIComponent(result.dog.id)}`,
      );
    }
    setOpen(false);
    setQuery("");
  };
  const goCustomer = (customerId: string) => {
    const base = module === "operations" ? "/operations" : "";
    navigate(`${base}/customer-management?customerId=${encodeURIComponent(customerId)}`);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative ml-auto sm:ml-4">
      <button
        type="button"
        aria-label="보호자와 반려견 검색"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-strong text-text-secondary hover:bg-primary-soft hover:text-primary sm:hidden"
        onClick={openSearch}
      >
        <Search size={18} />
      </button>
      <div className="hidden sm:block">
        <Search className="pointer-events-none absolute left-3 top-2.5 text-text-muted" size={16} />
        <input
          ref={desktopInputRef}
          type="search"
          value={query}
          aria-label="보호자명, 반려견명 또는 연락처 검색"
          placeholder="보호자 · 반려견 · 연락처"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          className="h-9 w-[min(30vw,22rem)] rounded-xl border border-border-strong bg-surface pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </div>

      {open && (
        <div className="fixed left-3 right-3 top-[3.5rem] z-50 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--pm-shadow-modal)] sm:absolute sm:left-auto sm:right-0 sm:top-[2.75rem] sm:w-[28rem]">
          <div className="flex items-center gap-2 border-b border-border p-3 sm:hidden">
            <Search size={17} className="text-text-muted" />
            <input
              ref={mobileInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="보호자명, 반려견명 또는 연락처 검색"
              placeholder="보호자 · 반려견 · 연락처"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none"
            />
            <button
              type="button"
              aria-label="검색 닫기"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-secondary"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="max-h-[min(70vh,28rem)] overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-text-secondary">
                <LoaderCircle size={17} className="animate-spin" /> 검색 준비 중
              </div>
            ) : error ? (
              <p className="px-4 py-8 text-center text-sm text-error">{error}</p>
            ) : !query.trim() ? (
              <p className="px-4 py-8 text-center text-sm text-text-muted">
                보호자명, 반려견명 또는 연락처를 입력하세요.
              </p>
            ) : results.length ? (
              results.map((result) => {
                const service = result.kind === "dog"
                  ? preferredDogService(result.dog.id, services)
                  : null;
                return (
                  <div
                    key={`${result.kind}:${result.kind === "customer" ? result.customer.id : result.dog.id}`}
                    className="flex items-stretch rounded-xl hover:bg-primary-subtle focus-within:ring-2 focus-within:ring-primary"
                  >
                    <button
                      type="button"
                      onClick={() => go(result)}
                      className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus:outline-none"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                        {result.kind === "customer" ? <UserRound size={17} /> : <Dog size={17} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm text-text-primary">
                          {result.kind === "customer"
                            ? result.customer.name || "이름 미등록"
                            : result.dog.name}
                        </strong>
                        <span className="mt-1 block truncate text-xs text-text-secondary">
                          {result.kind === "customer"
                            ? [
                                formatPhoneForDisplay(result.customer.phone),
                                result.dogs.map((dog) => dog.name).join(" · "),
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : [
                                result.familyContext ? "같은 가족" : null,
                                `보호자 ${result.customer?.name || "미등록"}`,
                                formatPhoneForDisplay(result.customer?.phone),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                        {result.kind === "dog" ? (
                          <div className="mt-2">
                            <DogCurrentService
                              service={service}
                              unavailable={!serviceStatusAvailable}
                            />
                          </div>
                        ) : null}
                      </span>
                    </button>
                    {result.kind === "dog" && result.customer ? (
                      <button
                        type="button"
                        aria-label={`${result.customer.name || "보호자"} 프로필`}
                        title="보호자 프로필"
                        onClick={() => goCustomer(result.customer!.id)}
                        className="m-2 flex w-10 shrink-0 items-center justify-center rounded-lg border-l border-border text-text-muted hover:bg-surface hover:text-primary focus:outline-none"
                      >
                        <UserRound size={16} />
                      </button>
                    ) : (
                      <span className="mr-3 mt-4 text-[11px] font-semibold text-text-muted">
                        Customer
                      </span>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="px-4 py-8 text-center text-sm text-text-muted">
                검색 결과가 없습니다.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
