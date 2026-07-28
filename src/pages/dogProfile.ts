export interface DogProfileActivity {
  id: string;
  saleDate: string;
  createdAt: string;
  businessUnitId: string;
  businessUnitName: string;
  productName: string;
  quantity: number;
  unitLabel: string | null;
  status: string;
  cancellationType: string | null;
}

export interface DogProfileActivityRow {
  id: string;
  sale_date: string;
  created_at: string;
  business_unit_id: string;
  business_unit_name: string;
  product_name: string;
  quantity: number | null;
  status: string;
  cancellation_type: string | null;
  products:
    | { unit_label: string | null }
    | Array<{ unit_label: string | null }>
    | null;
}

export function mapDogProfileActivity(
  row: DogProfileActivityRow,
): DogProfileActivity {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;

  return {
    id: row.id,
    saleDate: row.sale_date,
    createdAt: row.created_at,
    businessUnitId: row.business_unit_id,
    businessUnitName: row.business_unit_name,
    productName: row.product_name,
    quantity: Math.max(1, Number(row.quantity) || 1),
    unitLabel: product?.unit_label ?? null,
    status: row.status,
    cancellationType: row.cancellation_type,
  };
}

export interface DogUsageSummary {
  businessUnitId: string;
  businessUnitName: string;
  quantity: number;
  count: number;
  unitLabel: string | null;
}

export const isDogUsageActivity = (activity: DogProfileActivity) =>
  activity.status !== "cancelled" &&
  activity.cancellationType !== "entry_error";

export function activeDogActivities(activities: DogProfileActivity[]) {
  return activities
    .filter(isDogUsageActivity)
    .sort(
      (a, b) =>
        b.saleDate.localeCompare(a.saleDate) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export function summarizeDogUsage(
  activities: DogProfileActivity[],
): DogUsageSummary[] {
  const summaries = new Map<
    string,
    DogUsageSummary & { unitLabels: Set<string> }
  >();

  activeDogActivities(activities).forEach((activity) => {
    const key = activity.businessUnitId || activity.businessUnitName;
    const current = summaries.get(key) ?? {
      businessUnitId: activity.businessUnitId,
      businessUnitName: activity.businessUnitName,
      quantity: 0,
      count: 0,
      unitLabel: null,
      unitLabels: new Set<string>(),
    };
    current.quantity += Math.max(1, activity.quantity || 1);
    current.count += 1;
    if (activity.unitLabel?.trim()) current.unitLabels.add(activity.unitLabel.trim());
    summaries.set(key, current);
  });

  const order = (name: string) =>
    name.includes("유치원")
      ? 0
      : name.includes("교육")
        ? 1
        : name.includes("호텔")
          ? 2
          : 3;

  return [...summaries.values()]
    .map(({ unitLabels, ...summary }) => ({
      ...summary,
      unitLabel: unitLabels.size === 1 ? [...unitLabels][0] : null,
    }))
    .sort(
      (a, b) =>
        order(a.businessUnitName) - order(b.businessUnitName) ||
        a.businessUnitName.localeCompare(b.businessUnitName, "ko"),
    );
}

export function dogUsageDateRange(activities: DogProfileActivity[]) {
  const active = activeDogActivities(activities);
  return {
    firstDate: active.at(-1)?.saleDate ?? null,
    recentDate: active[0]?.saleDate ?? null,
  };
}
