import { CalendarDays, Dog, Eye, Phone, Plus, UserRound, UsersRound } from "lucide-react";
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
import {
  CustomerFamilyBookingForm,
  FamilyBookingRecordCard,
} from "./CustomerFamilyBookingMock";
import {
  createFamilyBookingFromDraft,
  familyBookingErrorMessage,
  familyBookingRepository,
} from "../platform/familyBookingRepository";
import type { FamilyBookingRecord } from "../platform/familyBookingRepositoryContract";
import { LongStayProfileSection } from "./LongStayProfileSection";
import { DaycareReservationModal } from "./DaycareReservationModal";

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
  const [familyBookingOpen, setFamilyBookingOpen] = useState(false);
  const [familyBookings, setFamilyBookings] = useState<readonly FamilyBookingRecord[]>([]);
  const [selectedFamilyBookingId, setSelectedFamilyBookingId] = useState<string | null>(null);
  const [familyBookingDetailsOpen, setFamilyBookingDetailsOpen] = useState(false);
  const [familyBookingSubmitting, setFamilyBookingSubmitting] = useState(false);
  const [familyBookingError, setFamilyBookingError] = useState("");
  const [daycareOpen, setDaycareOpen] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setData(null);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      loadCustomerDogDirectory(),
      familyBookingRepository.listByCustomer(customerId),
    ])
      .then(([result, bookings]) => {
        if (active) {
          setData(result);
          setFamilyBookings(bookings);
          setSelectedFamilyBookingId((current) => current ?? bookings[0]?.id ?? null);
        }
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

  useEffect(() => {
    setFamilyBookingOpen(false);
    setFamilyBookings([]);
    setSelectedFamilyBookingId(null);
    setFamilyBookingDetailsOpen(false);
    setFamilyBookingSubmitting(false);
    setFamilyBookingError("");
    setDaycareOpen(false);
  }, [customerId]);

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
  const selectedFamilyBooking = familyBookings.find(
    (booking) => booking.id === selectedFamilyBookingId,
  ) ?? familyBookings[0] ?? null;

  return (
    <Modal
      open={Boolean(customerId)}
      title={familyBookingOpen ? "Family Booking 예약 생성" : "보호자 프로필"}
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
      ) : familyBookingOpen ? (
        <CustomerFamilyBookingForm
          customerId={customer.id}
          customerName={customer.name || "이름 미등록"}
          dogs={dogs.map((dog) => ({ id: dog.id, name: dog.name, breed: dog.breed }))}
          initialBooking={null}
          onCancel={() => setFamilyBookingOpen(false)}
          submitting={familyBookingSubmitting}
          submissionError={familyBookingError}
          onComplete={async (booking) => {
            setFamilyBookingSubmitting(true);
            setFamilyBookingError("");
            try {
              const result = await createFamilyBookingFromDraft(booking);
              const detail = await familyBookingRepository.getById(result.id);
              setFamilyBookings((current) => [
                detail,
                ...current.filter((item) => item.id !== detail.id),
              ]);
              setSelectedFamilyBookingId(detail.id);
              setFamilyBookingDetailsOpen(true);
              setFamilyBookingOpen(false);
              setReloadKey((value) => value + 1);
            } catch (submissionError) {
              setFamilyBookingError(familyBookingErrorMessage(submissionError));
            } finally {
              setFamilyBookingSubmitting(false);
            }
          }}
        />
      ) : (
        <ProfileContent className="pt-1">
          <ProfileHeader
            title={customer.name || "이름 미등록"}
            status={<Badge tone={customer.active ? "green" : "gray"}>{customer.active ? "활성" : "비활성"}</Badge>}
            tags={<Badge tone="blue">반려견 {dogs.length}마리</Badge>}
            summary={formatPhoneForDisplay(customer.phone) || "연락처 미등록"}
            actions={
              customer.active ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => onAddDog(customer.id)}>
                    <Plus size={16} />
                    반려견 추가
                  </Button>
                  <Button variant="secondary" onClick={() => setDaycareOpen(true)} disabled={!dogs.length}>
                    <CalendarDays size={16} />
                    데이케어 예약
                  </Button>
                  <Button onClick={() => setFamilyBookingOpen(true)} disabled={!dogs.length}>
                    <UsersRound size={16} />
                    예약 생성
                  </Button>
                </div>
              ) : null
            }
          />

          <DaycareReservationModal
            open={daycareOpen}
            prefill={{ customerId: customer.id }}
            onClose={() => setDaycareOpen(false)}
            onSaved={() => setReloadKey((value) => value + 1)}
          />

          {selectedFamilyBooking ? (
            <ProfileSection
              id="customer-family-booking-preview-title"
              title="Family Booking"
              description="Family Booking과 각 반려견의 서비스 예약이 함께 생성되었습니다."
              action={(
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setFamilyBookingDetailsOpen((value) => !value)}
                  >
                    <Eye size={16} />
                    예약 상세 보기
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setFamilyBookingError("");
                      setFamilyBookingOpen(true);
                    }}
                  >
                    <Plus size={16} />
                    새 가족 예약 만들기
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => window.location.assign("/operations/calendar")}
                  >
                    개별 일정에서 수정
                  </Button>
                </div>
              )}
            >
              <FamilyBookingRecordCard
                booking={selectedFamilyBooking}
                expanded={familyBookingDetailsOpen}
                rooms={data?.hotelSnapshot?.rooms ?? []}
                onSharedRoomAllocated={async () => {
                  const latest = await familyBookingRepository.getById(selectedFamilyBooking.id);
                  setFamilyBookings((current) => current.map((item) => item.id === latest.id ? latest : item));
                  setReloadKey((value) => value + 1);
                }}
              />
            </ProfileSection>
          ) : null}

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

          <LongStayProfileSection
            customerId={customer.id}
            dogs={dogs.map((dog) => ({ id: dog.id, name: dog.name }))}
          />

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
              <div className="sm:max-h-[28rem] sm:overflow-y-auto sm:pr-1">
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
