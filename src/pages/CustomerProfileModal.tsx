import { CalendarDays, Dog, Phone, Plus, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ProfileContent,
  ProfileField,
  ProfileHeader,
  ProfileInfoGrid,
  ProfileSection,
  ProfileTimeline,
  ProfileTimelineItem,
} from "../components/profile";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
} from "../components/ui";
import { koDate } from "../lib/format";
import { formatPhoneForDisplay } from "../lib/phone";
import {
  CustomerServiceCountGrid,
  CustomerTimelineServiceBadge,
  DogCurrentService,
  customerDogServiceLabel,
} from "../components/CustomerDogServiceSummary";
import {
  customerServiceCounts,
  customerServiceDogNames,
  isSingleDogProfileName,
  preferredDogService,
} from "./customerDogArchitecture";
import {
  loadCustomerDogDirectory,
  type CustomerDogDirectoryData,
} from "./customerDogDirectory";

export function CustomerProfileModal({
  customerId,
  onClose,
  onOpenDog,
  onAddDog,
}: {
  customerId: string | null;
  onClose: () => void;
  onOpenDog: (dogId: string) => void;
  onAddDog: (customerId: string) => void;
}) {
  const [data, setData] = useState<CustomerDogDirectoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!customerId) {
      setData(null);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void loadCustomerDogDirectory()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError("보호자 프로필을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, reloadKey]);

  const customer = data?.customers.find((row) => row.id === customerId) ?? null;
  const dogs = useMemo(
    () =>
      (data?.dogs ?? [])
        .filter((dog) => dog.customerId === customerId && dog.active)
        .sort((left, right) => left.name.localeCompare(right.name, "ko")),
    [customerId, data?.dogs],
  );
  const timeline = useMemo(
    () =>
      (data?.timeline ?? [])
        .filter((entry) => entry.customerId === customerId)
        .slice(0, 30),
    [customerId, data?.timeline],
  );
  const serviceCounts = useMemo(
    () => customerServiceCounts(dogs.map((dog) => dog.id), data?.services ?? []),
    [data?.services, dogs],
  );
  const serviceDogNames = useMemo(
    () => customerServiceDogNames(dogs, data?.services ?? []),
    [data?.services, dogs],
  );

  return (
    <Modal
      open={Boolean(customerId)}
      title="보호자 프로필"
      onClose={onClose}
      resetKey={customerId ?? undefined}
      extraWide
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState title={error} retry={() => setReloadKey((value) => value + 1)} />
      ) : !customer ? (
        <EmptyState title="보호자 정보를 찾을 수 없습니다." />
      ) : (
        <ProfileContent className="pt-1">
          <ProfileHeader
            title={customer.name || "이름 미등록"}
            status={<Badge tone={customer.active ? "green" : "gray"}>{customer.active ? "활성" : "비활성"}</Badge>}
            tags={<Badge tone="blue">반려견 {dogs.length}마리</Badge>}
            summary={formatPhoneForDisplay(customer.phone) || "연락처 미등록"}
            actions={
              customer.active ? (
                <Button onClick={() => onAddDog(customer.id)}>
                  <Plus size={16} />
                  반려견 추가
                </Button>
              ) : null
            }
          />

          <ProfileInfoGrid className="sm:grid-cols-2 lg:grid-cols-4">
            <ProfileField
              icon={<UserRound size={15} />}
              label="보호자"
              value={customer.name || "이름 미등록"}
            />
            <ProfileField
              icon={<Phone size={15} />}
              label="연락처"
              value={formatPhoneForDisplay(customer.phone) || "미등록"}
            />
            <ProfileField label="주소" value={customer.address || "미등록"} />
            <ProfileField label="메모" value={customer.memo || "없음"} />
          </ProfileInfoGrid>

          <ProfileSection
            id="customer-profile-summary-title"
            title="현재 이용 현황"
            description="연결된 반려견의 오늘 서비스 상태를 한눈에 확인합니다."
          >
            <CustomerServiceCountGrid
              counts={serviceCounts}
              dogNames={serviceDogNames}
              available={data?.serviceStatusAvailable}
            />
          </ProfileSection>

          <ProfileSection
            id="customer-profile-dogs-title"
            title="반려견 현재 상태"
            description={
              data?.serviceStatusAvailable
                ? "각 서비스의 기존 조회 결과를 요약해 표시합니다."
                : "일부 서비스 상태를 불러오지 못해 확인 가능한 정보만 표시합니다."
            }
          >
            {dogs.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {dogs.map((dog) => {
                  const service = preferredDogService(
                    dog.id,
                    data?.services ?? [],
                  );
                  return (
                    <article
                      key={dog.id}
                      className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                          <Dog size={21} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-base text-text-primary">
                              {dog.name}
                            </strong>
                            {!isSingleDogProfileName(dog.name) ? (
                              <Badge tone="amber">Legacy</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-text-muted">
                            {dog.breed || "견종 미등록"}
                          </p>
                          <div className="mt-2">
                            <DogCurrentService
                              service={service}
                              unavailable={!data?.serviceStatusAvailable}
                            />
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          className="shrink-0 px-3"
                          onClick={() => onOpenDog(dog.id)}
                        >
                          프로필
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                compact
                title="연결된 활성 반려견이 없습니다."
                description="새 반려견을 등록하면 보호자 프로필에 표시됩니다."
              />
            )}
          </ProfileSection>

          <ProfileSection
            id="customer-profile-timeline-title"
            title="Customer Timeline"
            description="이 보호자에게 연결된 모든 반려견 이용 이력을 최신순으로 표시합니다."
            action={
              <span className="text-xs font-semibold text-text-muted">
                최근 {timeline.length}건
              </span>
            }
          >
            {timeline.length ? (
              <div className="max-h-[28rem] overflow-y-auto pr-1 sm:max-h-none sm:overflow-visible sm:pr-0">
              <ProfileTimeline>
                {timeline.map((entry, index) => (
                  <ProfileTimelineItem
                    key={entry.id}
                    last={index === timeline.length - 1}
                    date={koDate(entry.occurredAt.slice(0, 10))}
                    badge={
                      <CustomerTimelineServiceBadge domain={entry.domain} />
                    }
                    title={<><strong className="text-text-primary">{entry.dogName}</strong><span> · {entry.title}</span></>}
                    meta={
                      <span className="flex items-center gap-1" title={entry.detail ?? undefined}>
                        <CalendarDays size={13} />
                        {entry.detail || customerDogServiceLabel(entry.domain)}
                      </span>
                    }
                  />
                ))}
              </ProfileTimeline>
              </div>
            ) : (
              <EmptyState compact title="표시할 Customer Timeline이 없습니다." />
            )}
          </ProfileSection>
        </ProfileContent>
      )}
    </Modal>
  );
}
