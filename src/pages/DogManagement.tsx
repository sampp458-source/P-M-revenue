import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Eye, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterToolbar,
  Input,
  LoadingState,
  Modal,
  ConfirmModal,
  Pagination,
  PageHeader,
  SearchBox,
  Select,
  StatusBadge,
  Table,
  Textarea,
  Toast,
} from "../components/ui";
import { isMissingCustomerAddressColumn } from "../lib/customerAddressCapability";
import { formatPhoneForDisplay } from "../lib/phone";
import { supabase } from "../lib/supabase";
import {
  logSupabaseError,
  partyMutationError,
} from "../lib/supabaseError";
import {
  findCustomerPhoneDuplicate,
  findDogNameDuplicate,
  hasCustomerIdentity,
  normalizeCustomerPhone,
} from "./customerIdentity";
import {
  DogProfileModal,
  type DogProfileDog,
} from "./DogProfileModal";
import {
  mapDogProfileActivity,
  type DogProfileActivity,
  type DogProfileActivityRow,
} from "./dogProfile";
import { CustomerProfileModal } from "./CustomerProfileModal";
import {
  customerDogCountById,
  isSingleDogProfileName,
  preferredDogService,
  type CustomerDogServiceStatus,
} from "./customerDogArchitecture";
import { loadCurrentCustomerDogServices } from "./customerDogDirectory";
import { DogCurrentService } from "../components/CustomerDogServiceSummary";

interface OwnerOption {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  memo: string | null;
  is_active: boolean;
}

interface DogRow {
  id: string;
  customerId: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birthDate: string | null;
  weight: number | null;
  neutered: boolean | null;
  memo: string | null;
  active: boolean;
}

interface DogForm {
  id: string | null;
  customerId: string;
  name: string;
  breed: string;
  sex: "male" | "female" | "";
  birthDate: string;
  weight: string;
  neutered: "" | "yes" | "no";
  memo: string;
}

interface OwnerForm {
  name: string;
  phone: string;
  address: string;
  memo: string;
}

const emptyOwnerForm = (): OwnerForm => ({
  name: "",
  phone: "",
  address: "",
  memo: "",
});

const emptyForm = (): DogForm => ({
  id: null,
  customerId: "",
  name: "",
  breed: "",
  sex: "",
  birthDate: "",
  weight: "",
  neutered: "",
  memo: "",
});

function dogListSecondary(dog: DogRow) {
  const details: string[] = [];
  if (dog.sex === "male") details.push("수컷");
  if (dog.sex === "female") details.push("암컷");
  if (dog.birthDate) {
    const [year, month, day] = dog.birthDate.split("-").map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;
    if (
      today.getMonth() + 1 < month ||
      (today.getMonth() + 1 === month && today.getDate() < day)
    ) {
      age -= 1;
    }
    if (Number.isFinite(age) && age >= 0) details.push(`${age}세`);
  }
  return details.join(" · ");
}

async function loadOwnerOptions() {
  const result = await supabase
    .from("customers")
    .select("id, name, phone, address, memo, is_active")
    .order("name");

  if (!isMissingCustomerAddressColumn(result.error)) {
    return {
      data: (result.data ?? []) as OwnerOption[],
      error: result.error,
      status: result.status,
      addressSupported: true,
    };
  }

  const legacyResult = await supabase
    .from("customers")
    .select("id, name, phone, memo, is_active")
    .order("name");

  return {
    data: (legacyResult.data ?? []).map((owner) => ({
      ...owner,
      address: null,
    })) as OwnerOption[],
    error: legacyResult.error,
    status: legacyResult.status,
    addressSupported: false,
  };
}

function DogRowActions({
  dog,
  owner,
  canEditDog,
  canDeactivateDog,
  onOpenProfile,
  onEditOwner,
  onEditDog,
  onDeactivate,
}: {
  dog: DogRow;
  owner: OwnerOption | null;
  canEditDog: boolean;
  canDeactivateDog: boolean;
  onOpenProfile: () => void;
  onEditOwner: () => void;
  onEditDog: () => void;
  onDeactivate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeForViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("scroll", closeForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("scroll", closeForViewportChange, true);
    };
  }, [open]);

  return (
    <div className="mx-auto inline-flex w-fit items-center justify-center gap-1.5">
      <Button
        variant="secondary"
        className="h-9 min-h-9 gap-1.5 rounded-lg border-primary/25 bg-primary-subtle px-[0.5625rem] py-1.5 text-xs text-primary hover:border-primary/40 hover:bg-primary-soft"
        onClick={onOpenProfile}
      >
        <Eye size={15} />
        프로필
      </Button>
      {owner && (
        <Button
          variant="secondary"
          className="h-9 min-h-9 gap-1.5 rounded-lg px-[0.5625rem] py-1.5 text-xs"
          onClick={onEditOwner}
        >
          <Pencil size={15} />
          보호자 수정
        </Button>
      )}
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${dog.name} 관리 더보기`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (!open) {
              const rect = triggerRef.current?.getBoundingClientRect();
              if (rect) {
                setMenuPosition({
                  top: rect.bottom + 6,
                  right: Math.max(12, window.innerWidth - rect.right),
                });
              }
            }
            setOpen((value) => !value);
          }}
          className="inline-flex h-9 min-h-9 w-9 items-center justify-center rounded-lg border border-transparent p-0 leading-none text-text-secondary transition hover:border-primary/20 hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 [&>svg]:block"
        >
          <MoreHorizontal size={18} />
          <span className="sr-only">더보기</span>
        </button>
        {open && (
          <div
            role="menu"
            aria-label={`${dog.name} 관리`}
            style={menuPosition}
            className="fixed z-[70] min-w-48 overflow-hidden rounded-xl border border-border bg-surface p-1.5 text-left shadow-lg"
          >
            {canEditDog && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onEditDog();
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                반려견 정보 수정
              </button>
            )}
            {canDeactivateDog && dog.active && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onDeactivate();
                }}
                className="mt-1 w-full border-t border-border px-3 py-2 pt-2.5 text-left text-sm font-semibold text-error transition hover:bg-error-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                비활성화
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// UI freeze: preserve this layout after the final polish; bug fixes only.
export function PetManagementPage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canEditDog = profile?.isActive === true;
  const canDeactivateDog = profile?.role === "admin";
  const [dogs, setDogs] = useState<DogRow[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [currentServices, setCurrentServices] = useState<CustomerDogServiceStatus[]>([]);
  const [currentServicesAvailable, setCurrentServicesAvailable] = useState(true);
  const [ownerAddressSupported, setOwnerAddressSupported] = useState(true);
  const [query, setQuery] = useState("");
  const [breed, setBreed] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DogForm | null>(null);
  const [profileDogId, setProfileDogId] = useState<string | null>(null);
  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  const [profileActivities, setProfileActivities] = useState<DogProfileActivity[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerCreating, setOwnerCreating] = useState(false);
  const [ownerEditing, setOwnerEditing] = useState<OwnerOption | null>(null);
  const [ownerForm, setOwnerForm] = useState<OwnerForm>(emptyOwnerForm);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerError, setOwnerError] = useState("");
  const [deactivating, setDeactivating] = useState<DogRow | null>(null);
  const [duplicateDog, setDuplicateDog] = useState<DogRow | null>(null);
  const [allowDuplicateDog, setAllowDuplicateDog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const loadRequestIdRef = useRef(0);
  const handledProfileLinkRef = useRef("");
  const handledAddDogLinkRef = useRef("");
  const pageSize = 20;

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError("");
    const [dogsResult, ownersResult, serviceResult] = await Promise.all([
      supabase
        .from("dogs")
        .select("id, customer_id, name, breed, sex, birth_date, weight, neutered, memo, is_active, customers(id, name, phone, is_active)")
        .order("name"),
      loadOwnerOptions(),
      loadCurrentCustomerDogServices().catch(() => ({
        services: [] as CustomerDogServiceStatus[],
        available: false,
      })),
    ]);
    if (requestId !== loadRequestIdRef.current) return;
    if (dogsResult.error) {
      logSupabaseError("반려견 목록 조회", dogsResult.error, dogsResult.status);
      setDogs([]);
      setLoadError("반려견 목록을 불러오지 못했습니다.");
    } else if (ownersResult.error) {
      logSupabaseError("보호자 연결 정보 조회", ownersResult.error, ownersResult.status);
      setDogs([]);
      setLoadError("보호자 연결 정보를 불러오지 못했습니다.");
    } else {
      setDogs(
        (dogsResult.data ?? []).map((dog) => {
          const customer = Array.isArray(dog.customers) ? dog.customers[0] : dog.customers;
          return {
            id: dog.id,
            customerId: dog.customer_id,
            ownerName: customer?.name ?? null,
            ownerPhone: customer?.phone ?? null,
            name: dog.name,
            breed: dog.breed,
            sex: dog.sex as DogRow["sex"],
            birthDate: dog.birth_date,
            weight: dog.weight === null ? null : Number(dog.weight),
            neutered: dog.neutered,
            memo: dog.memo,
            active: dog.is_active,
          };
        }),
      );
      setOwners(ownersResult.data ?? []);
      setOwnerAddressSupported(ownersResult.addressSupported);
    }
    setCurrentServices(serviceResult.services);
    setCurrentServicesAvailable(serviceResult.available);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadData]);

  const loadProfileActivities = useCallback(async (dogId: string) => {
    setProfileLoading(true);
    setProfileError("");
    const result = await supabase
      .from("sales")
      .select(
        "id, sale_date, created_at, business_unit_id, business_unit_name, product_name, quantity, status, cancellation_type, product:products!sales_product_id_fkey(unit_label)",
      )
      .eq("dog_id", dogId)
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false });
    setProfileLoading(false);
    if (result.error) {
      logSupabaseError("반려견 프로필 이용 이력 조회", result.error, result.status);
      setProfileActivities([]);
      setProfileError("이용 이력을 불러오지 못했습니다.");
      return;
    }
    setProfileActivities(
      (result.data ?? []).map((row) =>
        mapDogProfileActivity(row as DogProfileActivityRow),
      ),
    );
  }, []);

  useEffect(() => {
    if (!profileDogId) {
      setProfileActivities([]);
      setProfileError("");
      return;
    }
    void loadProfileActivities(profileDogId);
  }, [loadProfileActivities, profileDogId]);

  const breeds = useMemo(
    () => [...new Set(dogs.map((dog) => dog.breed).filter((value): value is string => Boolean(value)))].sort(),
    [dogs],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko");
    return dogs.filter((dog) => {
      const keywordMatch =
        !keyword ||
        [dog.name, dog.ownerName, dog.ownerPhone, dog.breed].some((value) =>
          value?.toLocaleLowerCase("ko").includes(keyword),
        );
      return (
        keywordMatch &&
        (!breed || dog.breed === breed) &&
        (!activeFilter || dog.active === (activeFilter === "active"))
      );
    });
  }, [activeFilter, breed, dogs, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const visibleOwners = useMemo(() => {
    const keyword = ownerSearch.trim().toLocaleLowerCase("ko");
    return owners.filter(
      (owner) =>
        owner.id === editing?.customerId ||
        (owner.is_active &&
          (!keyword ||
            [owner.name, owner.phone].some((value) =>
              value?.toLocaleLowerCase("ko").includes(keyword),
            ))),
    );
  }, [editing?.customerId, ownerSearch, owners]);
  const selectedOwner = useMemo(
    () => owners.find((owner) => owner.id === editing?.customerId) ?? null,
    [editing?.customerId, owners],
  );
  const profileDog = useMemo(
    () => dogs.find((dog) => dog.id === profileDogId) ?? null,
    [dogs, profileDogId],
  );
  const profileOwner = useMemo(
    () =>
      owners.find((owner) => owner.id === profileDog?.customerId) ?? null,
    [owners, profileDog?.customerId],
  );
  const dogCountByCustomerId = useMemo(
    () => customerDogCountById(dogs),
    [dogs],
  );
  const openProfile = (dogId: string) => {
    setProfileActivities([]);
    setProfileError("");
    setProfileLoading(true);
    setProfileDogId(dogId);
  };
  const openCustomerProfile = (customerId: string) => {
    setProfileDogId(null);
    setProfileCustomerId(customerId);
  };
  const clearProfileParam = (key: "dogId" | "customerId") => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (loading) return;
    const requestedDogId = searchParams.get("dogId") ?? "";
    const requestedCustomerId = searchParams.get("customerId") ?? "";
    if (!requestedDogId && !requestedCustomerId) return;
    const target = dogs.find((dog) => dog.id === requestedDogId) ?? null;
    if (!target && !owners.some((owner) => owner.id === requestedCustomerId)) return;
    const linkKey = `${requestedDogId}|${requestedCustomerId}`;
    if (handledProfileLinkRef.current === linkKey) return;
    handledProfileLinkRef.current = linkKey;
    if (target) openProfile(target.id);
    else openCustomerProfile(requestedCustomerId);
  }, [dogs, loading, owners, searchParams]);

  useEffect(() => {
    if (loading) return;
    const customerId = searchParams.get("addDogForCustomerId") ?? "";
    if (!customerId || !owners.some((owner) => owner.id === customerId)) return;
    if (handledAddDogLinkRef.current === customerId) return;
    handledAddDogLinkRef.current = customerId;
    setFormError("");
    setOwnerSearch("");
    setDuplicateDog(null);
    setAllowDuplicateDog(false);
    setEditing({ ...emptyForm(), customerId });
    const next = new URLSearchParams(searchParams);
    next.delete("addDogForCustomerId");
    setSearchParams(next, { replace: true });
  }, [loading, owners, searchParams, setSearchParams]);

  const openEdit = (dog: DogRow) => {
    setFormError("");
    setOwnerSearch("");
    setDuplicateDog(null);
    setAllowDuplicateDog(false);
    setEditing({
      id: dog.id,
      customerId: dog.customerId ?? "",
      name: dog.name,
      breed: dog.breed ?? "",
      sex: dog.sex ?? "",
      birthDate: dog.birthDate ?? "",
      weight: dog.weight === null ? "" : String(dog.weight),
      neutered:
        dog.neutered === null ? "" : dog.neutered ? "yes" : "no",
      memo: dog.memo ?? "",
    });
  };

  const openOwnerCreate = () => {
    const initial = ownerSearch.trim();
    const looksLikePhone = /^[0-9\-\s]+$/.test(initial);
    setOwnerError("");
    setOwnerEditing(null);
    setOwnerForm({
      ...emptyOwnerForm(),
      name: looksLikePhone ? "" : initial,
      phone: looksLikePhone ? initial : "",
    });
    setOwnerCreating(true);
  };

  const openOwnerEdit = (owner: OwnerOption | null = selectedOwner) => {
    if (!owner) return;
    setOwnerError("");
    setOwnerForm({
      name: owner.name ?? "",
      phone: owner.phone ?? "",
      address: owner.address ?? "",
      memo: owner.memo ?? "",
    });
    setOwnerEditing(owner);
  };

  const saveOwner = async (event: FormEvent) => {
    event.preventDefault();
    if (ownerSaving) return;
    const name = ownerForm.name.trim();
    const phone = normalizeCustomerPhone(ownerForm.phone);
    if (!hasCustomerIdentity(name, phone)) {
      setOwnerError("보호자명 또는 연락처 중 하나는 입력해 주세요.");
      const formElement = event.currentTarget as HTMLFormElement;
      requestAnimationFrame(() => { const field = formElement.elements.namedItem("ownerName"); if (field instanceof HTMLElement) field.focus(); });
      return;
    }
    const duplicate = findCustomerPhoneDuplicate(
      owners.filter((owner) => owner.id !== ownerEditing?.id),
      phone,
    );
    if (duplicate) {
      if (ownerEditing) {
        setOwnerError(
          `동일 연락처의 기존 보호자(${duplicate.name || "이름 미등록"})가 있습니다.`,
        );
        return;
      }
      setEditing((current) => current ? { ...current, customerId: duplicate.id } : current);
      setOwnerSearch(`${duplicate.name || "이름 미등록"} ${duplicate.phone || ""}`.trim());
      setOwnerCreating(false);
      setNotice("동일 연락처의 기존 보호자를 선택했습니다.");
      return;
    }
    setOwnerSaving(true); setOwnerError("");
    const baseValues = {
      name: name || null,
      phone: phone || null,
      memo: ownerForm.memo.trim() || null,
    };
    const values = ownerAddressSupported
      ? {
          ...baseValues,
          address: ownerForm.address.trim() || null,
        }
      : baseValues;
    const ownerSelect = ownerAddressSupported
      ? "id, name, phone, address, memo, is_active"
      : "id, name, phone, memo, is_active";
    const result = ownerEditing
      ? await supabase
          .from("customers")
          .update(values)
          .eq("id", ownerEditing.id)
          .select(ownerSelect)
          .single()
      : await supabase
          .from("customers")
          .insert({ ...values, is_active: true })
          .select(ownerSelect)
          .single();
    setOwnerSaving(false);
    if (result.error) {
      logSupabaseError(
        ownerEditing
          ? "반려견 상세 보호자 수정"
          : "반려견 관리 보호자 등록",
        result.error,
        result.status,
      );
      setOwnerError(
        partyMutationError(
          result.error,
          ownerEditing
            ? "보호자 정보를 수정하지 못했습니다. 입력 내용을 확인해 주세요."
            : "보호자를 등록하지 못했습니다. 입력 내용을 확인해 주세요.",
        ),
      );
      return;
    }
    const resultOwner = result.data as unknown as OwnerOption;
    const savedOwner: OwnerOption = {
      ...resultOwner,
      address: resultOwner.address ?? null,
    };
    setOwners((current) => {
      const next = ownerEditing
        ? current.map((owner) =>
            owner.id === savedOwner.id ? savedOwner : owner,
          )
        : [...current, savedOwner];
      return next.sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", "ko"),
      );
    });
    setDogs((current) =>
      current.map((dog) =>
        dog.customerId === savedOwner.id
          ? {
              ...dog,
              ownerName: savedOwner.name,
              ownerPhone: savedOwner.phone,
            }
          : dog,
      ),
    );
    setEditing((current) => current ? { ...current, customerId: savedOwner.id } : current);
    setOwnerSearch(`${savedOwner.name || "이름 미등록"} ${savedOwner.phone || ""}`.trim());
    setOwnerCreating(false);
    setOwnerEditing(null);
    setNotice(
      ownerEditing
        ? "보호자 정보를 수정했습니다."
        : "새 보호자를 등록하고 자동으로 선택했습니다.",
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget as HTMLFormElement;
    const focus = (name: string) => requestAnimationFrame(() => { const field = formElement.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
    if (!editing) return;
    if (!editing.name.trim()) {
      setFormError("반려견명을 입력해 주세요.");
      focus("name");
      return;
    }
    const originalDog = editing.id
      ? dogs.find((dog) => dog.id === editing.id) ?? null
      : null;
    if (
      !isSingleDogProfileName(editing.name) &&
      editing.name.trim() !== originalDog?.name.trim()
    ) {
      setFormError("반려견은 한 마리씩 등록해 주세요. 이름을 쉼표나 기호로 묶을 수 없습니다.");
      focus("name");
      return;
    }
    if (!editing.id && profile?.role === "staff" && !editing.customerId) {
      setFormError("직원은 보호자를 선택한 뒤 반려견을 등록할 수 있습니다.");
      focus("customerId");
      return;
    }
    const weight = editing.weight === "" ? null : Number(editing.weight);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      setFormError("체중은 0보다 큰 값으로 입력해 주세요.");
      focus("weight");
      return;
    }
    if (editing.customerId && !owners.some((owner) => owner.id === editing.customerId)) {
      setFormError("선택한 보호자 정보를 확인할 수 없습니다.");
      focus("customerId");
      return;
    }
    if (!editing.id && !allowDuplicateDog) {
      const duplicate = findDogNameDuplicate(
        dogs,
        editing.customerId,
        editing.name,
      );
      if (duplicate) {
        setDuplicateDog(duplicate);
        setFormError("같은 보호자에게 동일한 이름의 반려견이 있습니다.");
        return;
      }
    }
    const values = {
      customer_id: editing.customerId || null,
      name: editing.name.trim(),
      breed: editing.breed.trim() || null,
      sex: editing.sex || null,
      birth_date: editing.birthDate || null,
      weight,
      neutered:
        editing.neutered === "" ? null : editing.neutered === "yes",
      memo: editing.memo.trim() || null,
    };
    setSaving(true);
    setFormError("");
    const result = editing.id
      ? await supabase.from("dogs").update(values).eq("id", editing.id).select("id").single()
      : await supabase.from("dogs").insert({ ...values, is_active: true }).select("id").single();
    setSaving(false);
    if (result.error) {
      logSupabaseError(
        editing.id ? "반려견 정보 수정" : "반려견 등록",
        result.error,
        result.status,
      );
      setFormError(
        partyMutationError(
          result.error,
          editing.id
            ? "반려견 정보를 수정하지 못했습니다."
            : "반려견을 저장하지 못했습니다.",
        ),
      );
      return;
    }
    setNotice(editing.id ? "반려견 정보를 수정했습니다." : "반려견을 등록했습니다.");
    setDuplicateDog(null);
    setAllowDuplicateDog(false);
    setEditing(null);
    await loadData();
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setProcessing(true);
    const result = await supabase
      .from("dogs")
      .update({ is_active: false })
      .eq("id", deactivating.id)
      .select("id")
      .single();
    setProcessing(false);
    if (result.error) {
      setNotice(result.error.code === "42501" ? "권한이 없습니다." : "반려견을 비활성화하지 못했습니다.");
      return;
    }
    setDeactivating(null);
    setNotice("반려견을 비활성화했습니다.");
    await loadData();
  };

  return (
    <>
      <PageHeader
        title="반려견 관리"
        description="반려견을 기준으로 보호자 연결 정보와 기본 정보를 관리합니다."
        action={<Button onClick={() => { setFormError(""); setOwnerSearch(""); setDuplicateDog(null); setAllowDuplicateDog(false); setEditing(emptyForm()); }}><Plus size={19} />반려견 등록</Button>}
      />
      <div className="[&>section]:mb-4">
        <FilterToolbar className="sm:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(9rem,2fr)]">
              <SearchBox className="[&_input]:placeholder:text-[#8793a3]" aria-label="반려견 검색" placeholder="반려견명, 보호자명, 연락처 또는 견종 검색" value={query} onClear={() => { setQuery(""); setPage(1); }} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
              <Select value={breed} onChange={(e) => { setBreed(e.target.value); setPage(1); }}><option value="">전체 견종</option>{breeds.map((item) => <option key={item}>{item}</option>)}</Select>
              <Select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}><option value="">전체 상태</option><option value="active">활성</option><option value="inactive">비활성</option></Select>
        </FilterToolbar>
      </div>
      <Card className="overflow-hidden">
        {loading ? <LoadingState /> : loadError ? <ErrorState title={loadError} retry={() => void loadData()} /> : rows.length ? (
          <>
            <div className="hidden xl:block">
              <Table
                className="table-fixed [&_td]:py-3.5 [&_th]:h-[52px] [&_th]:border-b-border-strong [&_th]:bg-surface-secondary/70 [&_th]:py-3"
                scrollResetKey={[
                  query,
                  breed,
                  activeFilter,
                  page,
                  profileDogId,
                  ownerEditing?.id,
                  editing?.id,
                ].join("|")}
              >
                <colgroup>
                  <col className="w-[17%]" />
                  <col className="w-[13%]" />
                  <col className="w-[15%]" />
                  <col className="w-[14%]" />
                  <col className="w-[17%]" />
                  <col className="w-[7%]" />
                  <col className="w-[230px]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>반려견</th>
                    <th>보호자</th>
                    <th>연락처</th>
                    <th>견종</th>
                    <th>현재 서비스</th>
                    <th className="px-3 text-center">상태</th>
                    <th className="px-3 text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((dog) => {
                    const owner =
                      owners.find((item) => item.id === dog.customerId) ?? null;
                    const secondary = dogListSecondary(dog);
                    const currentService = preferredDogService(
                      dog.id,
                      currentServices,
                    );
                    return (
                      <tr
                        key={dog.id}
                        className="bg-surface hover:[&>td]:!bg-[#f4f7fa] [&>td]:align-middle"
                      >
                        <td>
                          <button
                            type="button"
                            className="block min-w-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => openProfile(dog.id)}
                          >
                            <span className="block font-semibold text-text-primary transition hover:text-primary">
                              {dog.name}
                            </span>
                            {!isSingleDogProfileName(dog.name) ? (
                              <Badge tone="amber">Legacy · 다견 이름</Badge>
                            ) : null}
                            {secondary && (
                              <span className="mt-1 block text-xs font-normal text-text-muted">
                                {secondary}
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="font-medium text-text-secondary">
                          {dog.customerId ? (
                            <button
                              type="button"
                              className="rounded-md text-left hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              onClick={() => openCustomerProfile(dog.customerId!)}
                            >
                              <span>{dog.ownerName || "이름 미등록"}</span>
                              {(dogCountByCustomerId.get(dog.customerId) ?? 0) > 1 && (
                                <span className="ml-1.5 inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                                  다견 {dogCountByCustomerId.get(dog.customerId)}마리
                                </span>
                              )}
                            </button>
                          ) : (
                            "미등록"
                          )}
                        </td>
                        <td className="tabular-nums">
                          {formatPhoneForDisplay(dog.ownerPhone) || "미등록"}
                        </td>
                        <td>
                          <span
                            className="block truncate"
                            title={dog.breed || "미등록"}
                          >
                            {dog.breed || "미등록"}
                          </span>
                        </td>
                        <td>
                          <DogCurrentService
                            service={currentService}
                            unavailable={!currentServicesAvailable}
                          />
                        </td>
                        <td className="px-3 text-center [&>span]:px-3">
                          <StatusBadge status={dog.active ? "active" : "inactive"} />
                        </td>
                        <td className="px-3 text-center">
                          <DogRowActions
                            dog={dog}
                            owner={owner}
                            canEditDog={canEditDog}
                            canDeactivateDog={canDeactivateDog}
                            onOpenProfile={() => openProfile(dog.id)}
                            onEditOwner={() => openOwnerEdit(owner)}
                            onEditDog={() => openEdit(dog)}
                            onDeactivate={() => setDeactivating(dog)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <div className="divide-y divide-border xl:hidden">
              {rows.map((dog) => {
                const owner =
                  owners.find((item) => item.id === dog.customerId) ?? null;
                const secondary = dogListSecondary(dog);
                const currentService = preferredDogService(
                  dog.id,
                  currentServices,
                );
                return (
                  <article key={dog.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => openProfile(dog.id)}
                      >
                        <strong className="block text-base text-text-primary">
                          {dog.name}
                        </strong>
                        {!isSingleDogProfileName(dog.name) ? (
                          <span className="mt-1 inline-flex">
                            <Badge tone="amber">Legacy · 다견 이름</Badge>
                          </span>
                        ) : null}
                        <span className="mt-1 block text-sm text-text-secondary">
                          {[dog.breed || "견종 미등록", secondary]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                      <StatusBadge status={dog.active ? "active" : "inactive"} />
                    </div>
                    <dl className="mt-4 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-4 text-sm">
                      <dt className="text-text-muted">보호자</dt>
                      <dd className="font-medium text-text-primary">
                        {dog.customerId ? (
                          <button
                            type="button"
                            className="rounded-md text-left hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => openCustomerProfile(dog.customerId!)}
                          >
                            {dog.ownerName || "이름 미등록"}
                            {(dogCountByCustomerId.get(dog.customerId) ?? 0) > 1 && (
                              <span className="ml-1.5 text-xs font-semibold text-primary">
                                · 다견 {dogCountByCustomerId.get(dog.customerId)}마리
                              </span>
                            )}
                          </button>
                        ) : (
                          "미등록"
                        )}
                      </dd>
                      <dt className="text-text-muted">연락처</dt>
                      <dd className="whitespace-nowrap tabular-nums text-text-secondary">
                        {formatPhoneForDisplay(dog.ownerPhone) || "미등록"}
                      </dd>
                      <dt className="text-text-muted">현재 서비스</dt>
                      <dd>
                        <DogCurrentService
                          service={currentService}
                          unavailable={!currentServicesAvailable}
                        />
                      </dd>
                    </dl>
                    <div className="mt-4 border-t border-border pt-3">
                      <DogRowActions
                        dog={dog}
                        owner={owner}
                        canEditDog={canEditDog}
                        canDeactivateDog={canDeactivateDog}
                        onOpenProfile={() => openProfile(dog.id)}
                        onEditOwner={() => openOwnerEdit(owner)}
                        onEditDog={() => openEdit(dog)}
                        onDeactivate={() => setDeactivating(dog)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : <EmptyState title="등록된 반려견이 없습니다" description="검색 조건을 확인하거나 반려견을 등록해 주세요." />}
      </Card>
      {!loading && !loadError && filtered.length > 0 && <Pagination page={page} totalPages={totalPages} totalLabel={`총 ${filtered.length}마리`} onPageChange={setPage} />}
      <DogProfileModal
        dog={
          editing || ownerCreating || ownerEditing
            ? null
            : (profileDog as DogProfileDog | null)
        }
        owner={profileOwner}
        activities={profileActivities}
        loading={profileLoading}
        error={profileError}
        canEditDog={canEditDog}
        siblingDogCount={
          profileDog?.customerId
            ? (dogCountByCustomerId.get(profileDog.customerId) ?? 0)
            : 0
        }
        onClose={() => {
          setProfileDogId(null);
          clearProfileParam("dogId");
        }}
        onOpenCustomer={() => {
          if (!profileDog?.customerId) return;
          setProfileDogId(null);
          clearProfileParam("dogId");
          openCustomerProfile(profileDog.customerId);
        }}
        onEditDog={() => {
          if (profileDog) openEdit(profileDog);
        }}
        onEditOwner={() => openOwnerEdit(profileOwner)}
        onRetry={() => {
          if (profileDogId) void loadProfileActivities(profileDogId);
        }}
      />
      <CustomerProfileModal
        customerId={profileCustomerId}
        onClose={() => {
          setProfileCustomerId(null);
          clearProfileParam("customerId");
        }}
        onOpenDog={(dogId) => {
          setProfileCustomerId(null);
          clearProfileParam("customerId");
          openProfile(dogId);
        }}
        onAddDog={(customerId) => {
          setProfileCustomerId(null);
          clearProfileParam("customerId");
          setFormError("");
          setOwnerSearch("");
          setDuplicateDog(null);
          setAllowDuplicateDog(false);
          setEditing({ ...emptyForm(), customerId });
        }}
      />
      <Modal open={!!editing && !ownerCreating && !ownerEditing} onClose={() => !saving && setEditing(null)} title={editing?.id ? "반려견 수정" : "반려견 등록"} wide>
        {editing && <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Field label={profile?.role === "staff" && !editing.id ? "보호자 연결" : "보호자 연결 (선택)"}>
              <SearchBox aria-label="보호자 이름 또는 연락처 검색" placeholder="보호자 이름 또는 연락처 검색" value={ownerSearch} onClear={() => setOwnerSearch("")} onChange={(event) => setOwnerSearch(event.target.value)} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Select className="min-w-0" name="customerId" aria-describedby={formError ? "dog-form-error" : undefined} value={editing.customerId} disabled={saving} onChange={(e) => { setDuplicateDog(null); setAllowDuplicateDog(false); setEditing({ ...editing, customerId: e.target.value }); }}>
                <option value="">보호자 미등록</option>
                {visibleOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name || "이름 미등록"} · {formatPhoneForDisplay(owner.phone) || "연락처 미등록"}</option>)}
              </Select>
              <Button type="button" variant="secondary" disabled={saving} onClick={openOwnerCreate}><Plus size={16} />새 보호자</Button>
            </div>
            {selectedOwner && (
              <div className="mt-3 rounded-xl border border-border bg-surface-secondary p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm text-text-primary">
                      {selectedOwner.name || "이름 미등록"}
                    </strong>
                    <p className="mt-1 text-sm text-text-secondary">
                      {formatPhoneForDisplay(selectedOwner.phone) || "연락처 미등록"}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-sm" disabled={saving} onClick={() => openOwnerEdit()}>
                    <Pencil size={15} />
                    보호자 수정
                  </Button>
                </div>
                <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold text-text-muted">주소</dt>
                    <dd className="mt-1 break-words text-text-secondary">{selectedOwner.address || "미등록"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-text-muted">메모</dt>
                    <dd className="mt-1 break-words text-text-secondary">{selectedOwner.memo || "없음"}</dd>
                  </div>
                </dl>
              </div>
            )}
            {ownerSearch.trim() && visibleOwners.length === 0 && <p className="text-sm text-text-muted">검색된 활성 보호자가 없습니다. 새 보호자를 바로 등록할 수 있습니다.</p>}
          </div>
          <Field label="반려견명" required><Input name="name" aria-invalid={Boolean(formError && !editing.name.trim())} aria-describedby={formError ? "dog-form-error" : undefined} value={editing.name} disabled={saving} onChange={(e) => { setDuplicateDog(null); setAllowDuplicateDog(false); setEditing({ ...editing, name: e.target.value }); }} /></Field>
          <Field label="견종"><Input list="dog-breeds" value={editing.breed} disabled={saving} onChange={(e) => setEditing({ ...editing, breed: e.target.value })} /><datalist id="dog-breeds">{breeds.map((item) => <option key={item} value={item} />)}</datalist></Field>
          <Field label="성별"><Select value={editing.sex} disabled={saving} onChange={(e) => setEditing({ ...editing, sex: e.target.value as DogForm["sex"] })}><option value="">선택</option><option value="male">수컷</option><option value="female">암컷</option></Select></Field>
          <Field label="생년월일"><Input type="date" value={editing.birthDate} disabled={saving} onChange={(e) => setEditing({ ...editing, birthDate: e.target.value })} /></Field>
          <Field label="체중(kg)"><Input name="weight" aria-describedby={formError ? "dog-form-error" : undefined} type="number" min="0.01" step="0.01" value={editing.weight} disabled={saving} onChange={(e) => setEditing({ ...editing, weight: e.target.value })} /></Field>
          <Field label="중성화"><Select value={editing.neutered} disabled={saving} onChange={(e) => setEditing({ ...editing, neutered: e.target.value as DogForm["neutered"] })}><option value="">미등록</option><option value="yes">완료</option><option value="no">미완료</option></Select></Field>
          <div className="sm:col-span-2"><Field label="메모"><Textarea rows={3} value={editing.memo} disabled={saving} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} /></Field></div>
          {duplicateDog && !allowDuplicateDog && <div className="rounded-xl bg-warning-soft p-3 text-sm text-text-secondary sm:col-span-2"><p>같은 보호자에게 <strong className="text-text-primary">{duplicateDog.name}</strong>이(가) 이미 등록되어 있습니다.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { setQuery(duplicateDog.name); setEditing(null); setDuplicateDog(null); }}>기존 반려견 보기</Button><Button type="button" variant="ghost" onClick={() => { setAllowDuplicateDog(true); setFormError(""); }}>그래도 새로 등록</Button></div></div>}
          {formError && <p id="dog-form-error" role="alert" className="text-sm text-error sm:col-span-2">{formError}</p>}<Button className="sm:col-span-2" disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </form>}
      </Modal>
      <Modal
        open={ownerCreating || !!ownerEditing}
        onClose={() => {
          if (ownerSaving) return;
          setOwnerCreating(false);
          setOwnerEditing(null);
          setOwnerError("");
        }}
        title={ownerEditing ? "보호자 정보 수정" : "새 보호자 등록"}
      >
        <form onSubmit={saveOwner} className="space-y-4">
          <Field label="보호자명" help="이름 또는 연락처 중 하나는 필수입니다."><Input name="ownerName" value={ownerForm.name} disabled={ownerSaving} aria-invalid={Boolean(ownerError && !ownerForm.name.trim() && !ownerForm.phone.trim())} aria-describedby={ownerError ? "owner-create-error" : undefined} onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })} /></Field>
          <Field label="연락처"><Input name="ownerPhone" value={ownerForm.phone} disabled={ownerSaving} aria-invalid={Boolean(ownerError && !ownerForm.name.trim() && !ownerForm.phone.trim())} aria-describedby={ownerError ? "owner-create-error" : undefined} onChange={(event) => setOwnerForm({ ...ownerForm, phone: event.target.value })} /></Field>
          <Field
            label="주소"
            help={
              ownerAddressSupported
                ? undefined
                : "주소 저장 기능을 사용할 수 없습니다. 관리자에게 문의하세요."
            }
          >
            <Input
              name="ownerAddress"
              value={ownerForm.address}
              disabled={ownerSaving || !ownerAddressSupported}
              onChange={(event) =>
                setOwnerForm({ ...ownerForm, address: event.target.value })
              }
            />
          </Field>
          <Field label="메모"><Textarea rows={3} value={ownerForm.memo} disabled={ownerSaving} onChange={(event) => setOwnerForm({ ...ownerForm, memo: event.target.value })} /></Field>
          {ownerError && <p id="owner-create-error" role="alert" className="text-sm text-red-600">{ownerError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={ownerSaving} onClick={() => { setOwnerCreating(false); setOwnerEditing(null); setOwnerError(""); }}>취소</Button>
            <Button disabled={ownerSaving}>{ownerSaving ? "저장 중..." : ownerEditing ? "변경 저장" : "보호자 등록"}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal open={!!deactivating} onClose={() => setDeactivating(null)} onConfirm={() => void deactivate()} title="반려견 비활성화" confirmLabel="비활성화" processing={processing} description={<><b className="text-slate-900">{deactivating?.name}</b>을 비활성화하시겠습니까? 기존 매출과 이용 이력은 유지됩니다.</>} />
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}
