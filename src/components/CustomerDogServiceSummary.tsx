import {
  GraduationCap,
  Hotel,
  MessagesSquare,
  School,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  CustomerDogServiceDomain,
  CustomerDogServiceStatus,
} from "../pages/customerDogArchitecture";
import { compactDogNames } from "../pages/customerDogArchitecture";
import { Badge } from "./ui";

const presentation: Record<
  CustomerDogServiceDomain,
  {
    label: string;
    icon: ReactNode;
    tone: "blue" | "amber" | "green" | "gray";
    panel: string;
  }
> = {
  hotel: {
    label: "호텔",
    icon: <Hotel size={14} />,
    tone: "blue",
    panel: "bg-primary-subtle text-primary",
  },
  training: {
    label: "교육",
    icon: <GraduationCap size={14} />,
    tone: "amber",
    panel: "bg-warning-soft text-warning",
  },
  daycare: {
    label: "유치원",
    icon: <School size={14} />,
    tone: "green",
    panel: "bg-success-soft text-success",
  },
  consultation: {
    label: "상담",
    icon: <MessagesSquare size={14} />,
    tone: "gray",
    panel: "bg-surface-secondary text-text-secondary",
  },
};

export function CustomerServiceCountGrid({
  counts,
  dogNames,
  available = true,
  hideEmpty = false,
  className = "",
}: {
  counts: { hotel: number; training: number; daycare: number };
  dogNames?: { hotel: string[]; training: string[]; daycare: string[] };
  available?: boolean;
  hideEmpty?: boolean;
  className?: string;
}) {
  const domains = (["hotel", "training", "daycare"] as const).filter(
    (domain) => !hideEmpty || !available || counts[domain] > 0,
  );
  if (hideEmpty && available && domains.length === 0) {
    return <p className={className ? `${className} text-xs text-text-muted` : "text-xs text-text-muted"}>현재 이용 없음</p>;
  }
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {domains.map((domain) => {
        const item = presentation[domain];
        const names = dogNames?.[domain] ?? [];
        const nameSummary = compactDogNames(names);
        return (
          <div
            key={domain}
            className={`rounded-xl px-3 py-2.5 ${item.panel}`}
            aria-label={`${item.label} ${available ? counts[domain] : "확인 불가"}${nameSummary ? ` ${nameSummary}` : ""}`}
            title={names.length ? names.join(", ") : undefined}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              {item.icon}
              {item.label}
            </span>
            <strong className="mt-1.5 block text-base leading-none text-text-primary">
              {available ? counts[domain] : "-"}
            </strong>
            {available && nameSummary ? (
              <span className="mt-1.5 block truncate text-xs font-medium text-text-secondary">
                {nameSummary}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DogCurrentService({
  service,
  unavailable = false,
}: {
  service: CustomerDogServiceStatus | null;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return <span className="text-xs text-text-muted">서비스 상태 확인 불가</span>;
  }
  if (!service) {
    return <span className="text-xs text-text-muted">현재 이용 없음</span>;
  }
  const item = presentation[service.domain];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
        <span className={item.panel}>{item.icon}</span>
        <span>{item.label}</span>
      </div>
      <p className="mt-1 truncate text-xs text-text-muted" title={[service.status, service.detail].filter(Boolean).join(" · ")}>
        {[service.status, service.detail].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

export function CustomerTimelineServiceBadge({
  domain,
  children,
}: {
  domain: CustomerDogServiceDomain;
  children?: ReactNode;
}) {
  const item = presentation[domain];
  return (
    <Badge tone={item.tone}>
      <span className="mr-1">{item.icon}</span>
      {children ?? item.label}
    </Badge>
  );
}

export const customerDogServiceLabel = (domain: CustomerDogServiceDomain) =>
  presentation[domain].label;
