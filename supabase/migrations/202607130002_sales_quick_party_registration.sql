-- Phase 3 매출 등록 간편 고객·반려견 연결 보완
-- complete_schema.sql 적용 이후 이 파일만 한 번 실행한다.

begin;

create index if not exists customers_phone_lookup_idx
  on public.customers(phone);

create index if not exists dogs_active_name_search_idx
  on public.dogs(lower(name) text_pattern_ops)
  where is_active = true;

create or replace function public.quick_register_sale_party(
  p_customer_name text,
  p_phone text,
  p_dog_name text,
  p_breed text default null,
  p_sex text default null,
  p_birth_date date default null,
  p_weight numeric default null
)
returns table (
  customer_id uuid,
  customer_name text,
  customer_phone text,
  dog_id uuid,
  dog_name text,
  customer_created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_phone text;
  normalized_customer_name text;
  normalized_dog_name text;
  existing_customer public.customers%rowtype;
  selected_dog public.dogs%rowtype;
  created_customer boolean := false;
begin
  if not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;

  normalized_customer_name := btrim(coalesce(p_customer_name, ''));
  normalized_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_dog_name := btrim(coalesce(p_dog_name, ''));

  if normalized_customer_name = '' then
    raise exception '보호자 이름을 입력해주세요.' using errcode = 'P0001';
  end if;
  if normalized_phone !~ '^010[0-9]{8}$' then
    raise exception '연락처는 010으로 시작하는 11자리 번호여야 합니다.' using errcode = 'P0001';
  end if;
  if normalized_dog_name = '' then
    raise exception '반려견 이름을 입력해주세요.' using errcode = 'P0001';
  end if;
  if p_sex is not null and p_sex not in ('male', 'female') then
    raise exception '성별 값을 확인해주세요.' using errcode = 'P0001';
  end if;
  if p_weight is not null and p_weight <= 0 then
    raise exception '몸무게는 0보다 커야 합니다.' using errcode = 'P0001';
  end if;

  -- 같은 연락처가 동시에 등록되어도 보호자가 중복 생성되지 않도록 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 0));

  select c.* into existing_customer
  from public.customers c
  where c.phone = normalized_phone
     or regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  order by c.created_at
  limit 1;

  if existing_customer.id is null then
    insert into public.customers (name, phone, is_active)
    values (normalized_customer_name, normalized_phone, true)
    returning * into existing_customer;
    created_customer := true;
  elsif not existing_customer.is_active then
    raise exception '비활성 보호자는 간편 등록에서 선택할 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 기존 보호자라면 같은 이름의 반려견은 재사용하고, 없는 이름만 새로 추가한다.
  select d.* into selected_dog
  from public.dogs d
  where d.customer_id = existing_customer.id
    and d.is_active = true
    and lower(btrim(d.name)) = lower(normalized_dog_name)
  order by d.created_at
  limit 1;

  if selected_dog.id is null then
    insert into public.dogs (
      customer_id,
      name,
      breed,
      sex,
      birth_date,
      weight,
      is_active
    )
    values (
      existing_customer.id,
      normalized_dog_name,
      nullif(btrim(coalesce(p_breed, '')), ''),
      p_sex,
      p_birth_date,
      p_weight,
      true
    )
    returning * into selected_dog;
  end if;

  return query select
    existing_customer.id,
    coalesce(existing_customer.name, normalized_customer_name),
    coalesce(existing_customer.phone, normalized_phone),
    selected_dog.id,
    selected_dog.name,
    created_customer;
end;
$$;

revoke all on function public.quick_register_sale_party(
  text, text, text, text, text, date, numeric
) from public;

grant execute on function public.quick_register_sale_party(
  text, text, text, text, text, date, numeric
) to authenticated;

commit;
