import {
  Clock3,
  Pencil,
  UserRound,
} from "lucide-react";
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
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  StatusBadge,
} from "../components/ui";
import { koDate } from "../lib/format";
import { formatPhoneForDisplay } from "../lib/phone";
import {
  dashboardThemeCode,
  dashboardThemeStyle,
} from "./dashboard/dashboardTheme";
import {
  activeDogActivities,
  dogUsageDateRange,
  formatDogUsageQuantity,
  summarizeDogUsage,
  type DogProfileActivity,
} from "./dogProfile";

export interface DogProfileDog {
  id: string;
  customerId: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birthDate: string | null;
  weight: number | null;
  neutered: boolean | null;
  memo: string | null;
  active: boolean;
}

export interface DogProfileOwner {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  memo: string | null;
  is_active: boolean;
}

export function DogProfileModal({
  dog,
  owner,
  activities,
  loading,
  error,
  canEditDog,
  siblingDogCount,
  onClose,
  onOpenCustomer,
  onEditDog,
  onEditOwner,
  onRetry,
}: {
  dog: DogProfileDog | null;
  owner: DogProfileOwner | null;
  activities: DogProfileActivity[];
  loading: boolean;
  error: string;
  canEditDog: boolean;
  siblingDogCount: number;
  onClose: () => void;
  onOpenCustomer: () => void;
  onEditDog: () => void;
  onEditOwner: () => void;
  onRetry: () => void;
}) {
  if (!dog) return null;
  const activeActivities = activeDogActivities(activities);
  const usage = summarizeDogUsage(activities);
  const dates = dogUsageDateRange(activities);
  const recentUsageLabel = loading
    ? "최근 이용 확인 중"
    : error
      ? "최근 이용 확인 불가"
      : dates.recentDate
        ? `최근 이용 ${koDate(dates.recentDate)}`
        : "최근 이용 없음";

  return (
    <Modal
      open
      title="반려견 프로필"
      onClose={onClose}
      resetKey={dog.id}
      wide
    >
      <ProfileContent className="pt-1">
        <ProfileHeader
          className="pt-1"
          title={dog.name}
          status={<StatusBadge status={dog.active ? "active" : "inactive"} />}
          summary={
            <>
              {dog.breed || "품종 미등록"} · 보호자 {owner?.name || "미등록"} ·{" "}
              {recentUsageLabel}
            </>
          }
          actions={
            canEditDog ? (
            <Button variant="secondary" onClick={onEditDog}>
              <Pencil size={16} />
              반려견 정보 수정
            </Button>
            ) : null
          }
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <button
            type="button"
            disabled={!owner}
            onClick={onOpenCustomer}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-primary-subtle p-4 text-left transition hover:border-primary/25 hover:bg-primary-soft disabled:cursor-default disabled:opacity-70 sm:w-auto sm:min-w-80"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-sm">
              <UserRound size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm text-text-primary">
                {owner?.name || "보호자 미등록"}
              </strong>
              <span className="mt-1 block text-xs text-text-secondary">
                {owner
                  ? `${formatPhoneForDisplay(owner.phone) || "연락처 미등록"} · ${Math.max(1, siblingDogCount)}마리`
                  : "연결된 Customer가 없습니다."}
              </span>
            </span>
            {owner && (
              <span className="text-xs font-semibold text-primary">
                보호자 프로필
              </span>
            )}
          </button>
          {owner && canEditDog && (
            <Button variant="secondary" onClick={onEditOwner}>
              <Pencil size={15} />
              보호자 수정
            </Button>
          )}
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="반려견 프로필 구성">
          {["기본정보", "Timeline", "호텔", "교육", "유치원", "메모", "사진"].map(
            (label, index) => (
              <span
                key={label}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  index === 0
                    ? "border-primary/25 bg-primary-soft text-primary"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                {label}
              </span>
            ),
          )}
        </nav>

        <div className="grid items-start gap-7 lg:grid-cols-2">
          <div className="space-y-7">
        <ProfileSection id="dog-profile-basic-title" title="반려견 정보">
          <ProfileInfoGrid className="sm:grid-cols-2 lg:!grid-cols-2">
            <ProfileField
              label="성별"
              value={dog.sex === "male" ? "수컷" : dog.sex === "female" ? "암컷" : "미등록"}
            />
            <ProfileField
              label="생년월일"
              value={dog.birthDate ? koDate(dog.birthDate) : "미등록"}
            />
            <ProfileField
              label="몸무게"
              value={dog.weight === null ? "미등록" : `${dog.weight}kg`}
            />
            <ProfileField
              label="중성화"
              value={dog.neutered === null ? "미등록" : dog.neutered ? "완료" : "미완료"}
            />
          </ProfileInfoGrid>
        </ProfileSection>
          </div>

          <div className="space-y-7">
        <ProfileSection
          id="dog-profile-usage-title"
          title="이용 정보"
          action={
            loading ? (
              <span className="text-xs text-text-muted">확인 중</span>
            ) : error ? (
              <span className="text-xs font-medium text-error">조회 실패</span>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>첫 이용 {dates.firstDate ? koDate(dates.firstDate) : "-"}</span>
                <span>최근 이용 {dates.recentDate ? koDate(dates.recentDate) : "-"}</span>
              </div>
            )
          }
        >
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : usage.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {usage.map((item) => {
                const themeCode = dashboardThemeCode(
                  item.businessUnitId,
                  item.businessUnitName,
                );
                return (
                  <div
                    key={item.businessUnitId || item.businessUnitName}
                    style={dashboardThemeStyle(themeCode)}
                    className="rounded-2xl border [border-color:rgb(var(--pm-theme-rgb)/0.18)] bg-[var(--pm-theme-tint-1)] p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--pm-theme-accent)]" />
                      <span className="text-sm font-semibold text-text-secondary">
                        {item.businessUnitName}
                      </span>
                    </div>
                    <strong className="mt-3 block text-2xl font-bold tabular-nums text-[var(--pm-theme-accent)]">
                      {item.unitLabel
                        ? formatDogUsageQuantity(item.quantity, item.unitLabel)
                        : `${item.count.toLocaleString("ko-KR")}건`}
                    </strong>
                    <span className="mt-1 block text-xs text-text-muted">
                      이용 기록 {item.count.toLocaleString("ko-KR")}건
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="아직 이용 기록이 없습니다." />
          )}
        </ProfileSection>

        <ProfileSection
          id="dog-profile-memo-title"
          title="메모"
          action={
            canEditDog ? (
              <Button variant="ghost" onClick={onEditDog}>
                <Pencil size={15} />
                수정
              </Button>
            ) : null
          }
        >
          <p className="min-h-20 whitespace-pre-wrap rounded-2xl bg-amber-50/70 p-5 text-sm leading-7 text-text-secondary">
            {dog.memo || "등록된 주의사항이나 특이사항이 없습니다."}
          </p>
        </ProfileSection>
          </div>
        </div>

        <ProfileSection
          id="dog-profile-timeline-title"
          title="Timeline"
          description="확인된 이용 기록을 최신순으로 표시합니다."
        >
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : activeActivities.length ? (
            <ProfileTimeline
              countLabel={`총 ${activeActivities.length.toLocaleString("ko-KR")}건`}
            >
              {activeActivities.map((activity, index) => {
                const themeCode = dashboardThemeCode(
                  activity.businessUnitId,
                  activity.businessUnitName,
                );
                return (
                  <ProfileTimelineItem
                    key={activity.id}
                    style={dashboardThemeStyle(themeCode)}
                    last={index === activeActivities.length - 1}
                    date={koDate(activity.saleDate)}
                    badge={
                      <span className="rounded-full bg-[var(--pm-theme-tint-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--pm-theme-accent)]">
                        {activity.businessUnitName}
                      </span>
                    }
                    title={activity.productName}
                    meta={
                      <span className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                        <Clock3 size={13} />
                        {formatDogUsageQuantity(
                          activity.quantity,
                          activity.unitLabel,
                        )}
                      </span>
                    }
                  />
                );
              })}
            </ProfileTimeline>
          ) : (
            <EmptyState compact title="표시할 Timeline이 없습니다." />
          )}
        </ProfileSection>

        <ProfileSection
          id="dog-profile-photo-title"
          title="사진"
          description="이 반려견 전용 사진 영역입니다."
        >
          <EmptyState compact title="등록된 사진이 없습니다." />
        </ProfileSection>
      </ProfileContent>
    </Modal>
  );
}
