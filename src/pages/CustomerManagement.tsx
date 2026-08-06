import { Dog, Eye, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  Table,
} from "../components/ui";
import { formatPhoneForDisplay } from "../lib/phone";
import {
  compactDogNames,
  customerServiceCounts,
  customerServiceDogNames,
} from "./customerDogArchitecture";
import {
  CustomerServiceCountGrid,
  customerDogServiceLabel,
} from "../components/CustomerDogServiceSummary";
import {
  loadCustomerDogDirectory,
  type CustomerDogDirectoryData,
} from "./customerDogDirectory";
import { CustomerProfileModal } from "./CustomerProfileModal";

const pageSize = 20;

const recentDateLabel = (value: string) => {
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
};

export function CustomerManagementPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const operations = location.pathname.startsWith("/operations/");
  const [data, setData] = useState<CustomerDogDirectoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const selectedCustomerId = searchParams.get("customerId");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadCustomerDogDirectory());
    } catch {
      setData(null);
      setError("보호자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dogIdsByCustomer = useMemo(() => {
    const grouped = new Map<string, string[]>();
    (data?.dogs ?? []).forEach((dog) => {
      if (!dog.active || !dog.customerId) return;
      grouped.set(dog.customerId, [
        ...(grouped.get(dog.customerId) ?? []),
        dog.id,
      ]);
    });
    return grouped;
  }, [data?.dogs]);

  const rows = useMemo(
    () =>
      (data?.customers ?? [])
        .filter(
          (customer) =>
            !activeFilter || customer.active === (activeFilter === "active"),
        )
        .map((customer) => {
          const dogIds = dogIdsByCustomer.get(customer.id) ?? [];
          const customerDogs = (data?.dogs ?? []).filter(
            (dog) => dog.active && dog.customerId === customer.id,
          );
          return {
            customer,
            dogCount: dogIds.length,
            serviceCounts: customerServiceCounts(
              dogIds,
              data?.services ?? [],
            ),
            serviceDogNames: customerServiceDogNames(
              customerDogs,
              data?.services ?? [],
            ),
            recentUse: data?.recentUseDetailByCustomerId.get(customer.id) ?? null,
          };
        }),
    [activeFilter, data, dogIdsByCustomer],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const setCustomerProfile = (customerId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (customerId) next.set("customerId", customerId);
    else next.delete("customerId");
    setSearchParams(next, { replace: true });
  };

  const dogManagementPath = operations ? "/operations/customers" : "/customers";

  return (
    <>
      <PageHeader
        title="보호자 관리"
        description="Customer를 기준으로 연결된 반려견과 현재 이용 상태를 확인합니다."
      />

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <UsersRound size={20} />
            </span>
            <div>
              <strong className="text-sm text-text-primary">
                Customer {rows.length.toLocaleString("ko-KR")}명
              </strong>
              <p className="mt-0.5 text-xs text-text-muted">
                검색은 화면 상단 통합 검색을 이용하세요.
              </p>
            </div>
          </div>
          <Select
            className="sm:w-36"
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="active">활성 보호자</option>
            <option value="inactive">비활성 보호자</option>
            <option value="">전체 상태</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState title={error} retry={() => void load()} />
        ) : visibleRows.length ? (
          <>
            <div className="hidden xl:block">
              <Table className="table-fixed [&_td]:py-3.5 [&_th]:bg-surface-secondary/70">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[7%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[14%]" />
                  <col className="w-[21%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>보호자</th>
                    <th>반려견</th>
                    <th>호텔</th>
                    <th>교육</th>
                    <th>유치원</th>
                    <th>연락처</th>
                    <th>최근 이용일</th>
                    <th className="text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(
                    ({ customer, dogCount, serviceCounts, serviceDogNames, recentUse }) => (
                      <tr key={customer.id}>
                        <td>
                          <button
                            type="button"
                            className="rounded-md text-left font-semibold text-text-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => setCustomerProfile(customer.id)}
                          >
                            {customer.name || "이름 미등록"}
                          </button>
                        </td>
                        <td>
                          <Badge tone="blue">
                            <Dog size={13} /> {dogCount}
                          </Badge>
                        </td>
                        <td className="min-w-0 text-primary">
                          <strong>{data?.serviceStatusAvailable ? serviceCounts.hotel : "-"}</strong>
                          {serviceDogNames.hotel.length ? <span className="mt-0.5 block truncate text-xs text-text-muted" title={serviceDogNames.hotel.join(", ")}>{compactDogNames(serviceDogNames.hotel)}</span> : null}
                        </td>
                        <td className="min-w-0 text-warning">
                          <strong>{data?.serviceStatusAvailable ? serviceCounts.training : "-"}</strong>
                          {serviceDogNames.training.length ? <span className="mt-0.5 block truncate text-xs text-text-muted" title={serviceDogNames.training.join(", ")}>{compactDogNames(serviceDogNames.training)}</span> : null}
                        </td>
                        <td className="min-w-0 text-success">
                          <strong>{data?.serviceStatusAvailable ? serviceCounts.daycare : "-"}</strong>
                          {serviceDogNames.daycare.length ? <span className="mt-0.5 block truncate text-xs text-text-muted" title={serviceDogNames.daycare.join(", ")}>{compactDogNames(serviceDogNames.daycare)}</span> : null}
                        </td>
                        <td className="tabular-nums">
                          {formatPhoneForDisplay(customer.phone) || "미등록"}
                        </td>
                        <td className="min-w-0">
                          {recentUse ? (
                            <span className="block truncate text-xs text-text-secondary" title={`${recentDateLabel(recentUse.occurredOn)} · ${customerDogServiceLabel(recentUse.domain)} · ${recentUse.dogName}`}>
                              {recentDateLabel(recentUse.occurredOn)} · {customerDogServiceLabel(recentUse.domain)} · {recentUse.dogName}
                            </span>
                          ) : <span className="text-xs text-text-muted">최근 이용 없음</span>}
                        </td>
                        <td className="text-center">
                          <Button
                            variant="secondary"
                            className="min-h-9 px-3 py-1.5 text-xs"
                            onClick={() => setCustomerProfile(customer.id)}
                          >
                            <Eye size={15} />
                            Profile
                          </Button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </Table>
            </div>

            <div className="divide-y divide-border xl:hidden">
              {visibleRows.map(
                ({ customer, dogCount, serviceCounts, serviceDogNames, recentUse }) => (
                  <article key={customer.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => setCustomerProfile(customer.id)}
                      >
                        <strong className="block text-base text-text-primary">
                          {customer.name || "이름 미등록"}
                        </strong>
                        <span className="mt-1 block tabular-nums text-sm text-text-secondary">
                          {formatPhoneForDisplay(customer.phone) || "연락처 미등록"}
                        </span>
                      </button>
                      <Badge tone="blue">반려견 {dogCount}마리</Badge>
                    </div>
                    <CustomerServiceCountGrid
                      className="mt-4"
                      counts={serviceCounts}
                      dogNames={serviceDogNames}
                      available={data?.serviceStatusAvailable}
                      hideEmpty
                    />
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                      <span className="text-xs text-text-muted">
                        {recentUse ? `최근 이용 ${recentDateLabel(recentUse.occurredOn)} · ${customerDogServiceLabel(recentUse.domain)} · ${recentUse.dogName}` : "최근 이용 없음"}
                      </span>
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1.5 text-xs"
                        onClick={() => setCustomerProfile(customer.id)}
                      >
                        Profile
                      </Button>
                    </div>
                  </article>
                ),
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title="표시할 보호자가 없습니다."
            description="상태 조건을 변경하거나 통합 검색을 이용해 주세요."
          />
        )}
      </Card>

      {!loading && !error && rows.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalLabel={`총 ${rows.length}명`}
          onPageChange={setPage}
        />
      )}

      <CustomerProfileModal
        customerId={selectedCustomerId}
        onClose={() => setCustomerProfile(null)}
        onOpenDog={(dogId) =>
          navigate(`${dogManagementPath}?dogId=${encodeURIComponent(dogId)}`)
        }
        onAddDog={(customerId) =>
          navigate(
            `${dogManagementPath}?addDogForCustomerId=${encodeURIComponent(customerId)}`,
          )
        }
      />
    </>
  );
}
