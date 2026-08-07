-- =====================================================================
-- Inventário Hotel — schema unificado (F&B mensal + FO/HSK semanal)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
do $$ begin
  create type department as enum ('FO','HSK','FB');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('admin','fo','hsk','fb');
exception when duplicate_object then null; end $$;

do $$ begin
  create type period_kind as enum ('semanal','mensal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type count_status as enum ('rascunho','submetido');
exception when duplicate_object then null; end $$;

-- ---------- Utilidades ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Hotéis ----------
create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_hotels_touch on public.hotels;
create trigger trg_hotels_touch before update on public.hotels
  for each row execute function public.touch_updated_at();

-- ---------- Perfis e permissões ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- cria perfil automaticamente ao registar utilizador
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- verificação de papel sem recursão de RLS
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin');
$$;

-- pode escrever no departamento?
create or replace function public.can_write_dept(_dept department)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
      or (_dept = 'FO'::department  and public.has_role(auth.uid(), 'fo'))
      or (_dept = 'HSK'::department and public.has_role(auth.uid(), 'hsk'))
      or (_dept = 'FB'::department  and public.has_role(auth.uid(), 'fb'));
$$;

-- ---------- Catálogo (itens FO/HSK + produtos F&B) ----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid references public.hotels(id) on delete cascade,  -- null = catálogo partilhado (F&B)
  department department not null,
  ref text,                       -- código de fornecedor (F&B)
  name text not null,
  category text,                  -- categoria F&B
  supplier text,
  unit text not null default 'Un',
  unit_price_eur numeric(12,4),
  par_qty numeric(12,3),
  active boolean not null default true,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists items_global_ref_uniq
  on public.items (department, ref) where hotel_id is null and ref is not null;
create unique index if not exists items_hotel_name_uniq
  on public.items (hotel_id, department, name) where hotel_id is not null;
create index if not exists items_dept_idx on public.items (department, active);
drop trigger if exists trg_items_touch on public.items;
create trigger trg_items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ---------- Períodos (semanas FO/HSK + meses F&B) ----------
create table if not exists public.periods (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  department department not null,
  kind period_kind not null,
  start_date date not null,
  end_date date not null,
  label text not null,
  occupied_rooms integer,
  status count_status not null default 'rascunho',
  submitted_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, department, start_date)
);
create index if not exists periods_lookup_idx on public.periods (hotel_id, department, start_date desc);
drop trigger if exists trg_periods_touch on public.periods;
create trigger trg_periods_touch before update on public.periods
  for each row execute function public.touch_updated_at();

-- ---------- Contagens ----------
create table if not exists public.counts (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  opening_qty numeric(12,3) not null default 0,
  purchased_qty numeric(12,3) not null default 0,
  amount_paid_eur numeric(12,2) not null default 0,
  closing_qty numeric(12,3) not null default 0,
  closing_counted boolean not null default false,
  quebras numeric(12,3) not null default 0,
  motivo text,
  comentario text,
  unit_price_eur numeric(12,4),   -- preço fixado no momento (null = usa o do item)
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, item_id)
);
create index if not exists counts_period_idx on public.counts (period_id);
create index if not exists counts_item_idx on public.counts (item_id);
drop trigger if exists trg_counts_touch on public.counts;
create trigger trg_counts_touch before update on public.counts
  for each row execute function public.touch_updated_at();

-- ---------- Compras (encomendas FO/HSK) ----------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  qty numeric(12,3) not null default 0,
  amount_paid_eur numeric(12,2) not null default 0,
  order_date date not null default current_date,
  received_date date,
  created_at timestamptz not null default now()
);
create index if not exists purchases_hotel_idx on public.purchases (hotel_id, order_date desc);

-- ---------- Vista de cálculo ----------
create or replace view public.v_counts as
select
  c.id,
  p.hotel_id,
  h.slug          as hotel_slug,
  h.name          as hotel_name,
  p.department,
  p.kind,
  p.id            as period_id,
  p.start_date,
  p.end_date,
  p.label,
  p.occupied_rooms,
  p.status,
  i.id            as item_id,
  i.name          as item_name,
  i.ref,
  i.category,
  i.supplier,
  i.unit,
  coalesce(c.unit_price_eur, i.unit_price_eur) as unit_price_eur,
  c.opening_qty,
  c.purchased_qty,
  c.amount_paid_eur,
  c.closing_qty,
  c.quebras,
  c.motivo,
  c.comentario,
  (c.opening_qty + c.purchased_qty - c.closing_qty) as used_qty,
  case when coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else (c.opening_qty + c.purchased_qty - c.closing_qty) * coalesce(c.unit_price_eur, i.unit_price_eur)
  end as cost_used_eur,
  case when coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else c.closing_qty * coalesce(c.unit_price_eur, i.unit_price_eur)
  end as stock_value_eur,
  case when p.occupied_rooms is null or p.occupied_rooms = 0 then null
       else (c.opening_qty + c.purchased_qty - c.closing_qty) / p.occupied_rooms
  end as used_per_room,
  case when p.occupied_rooms is null or p.occupied_rooms = 0
         or coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else ((c.opening_qty + c.purchased_qty - c.closing_qty) * coalesce(c.unit_price_eur, i.unit_price_eur)) / p.occupied_rooms
  end as cost_per_room_eur,
  c.updated_at,
  c.updated_by
from public.counts c
join public.periods p on p.id = c.period_id
join public.hotels  h on h.id = p.hotel_id
join public.items   i on i.id = c.item_id;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.hotels     enable row level security;
alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;
alter table public.items      enable row level security;
alter table public.periods    enable row level security;
alter table public.counts     enable row level security;
alter table public.purchases  enable row level security;

-- hotels: todos leem, admin escreve
drop policy if exists hotels_read on public.hotels;
create policy hotels_read on public.hotels for select to authenticated using (true);
drop policy if exists hotels_write on public.hotels;
create policy hotels_write on public.hotels for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles: cada um lê o seu; admin lê e escreve tudo
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_roles: cada um vê os seus; admin gere
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists user_roles_admin on public.user_roles;
create policy user_roles_admin on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- items: todos leem, admin escreve
drop policy if exists items_read on public.items;
create policy items_read on public.items for select to authenticated using (true);
drop policy if exists items_write on public.items;
create policy items_write on public.items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- periods: todos leem; escreve quem tem o papel do departamento
drop policy if exists periods_read on public.periods;
create policy periods_read on public.periods for select to authenticated using (true);
drop policy if exists periods_ins on public.periods;
create policy periods_ins on public.periods for insert to authenticated
  with check (public.can_write_dept(department));
drop policy if exists periods_upd on public.periods;
create policy periods_upd on public.periods for update to authenticated
  using (public.can_write_dept(department)) with check (public.can_write_dept(department));
drop policy if exists periods_del on public.periods;
create policy periods_del on public.periods for delete to authenticated using (public.is_admin());

-- counts: todos leem; escreve quem tem o papel do departamento do período
drop policy if exists counts_read on public.counts;
create policy counts_read on public.counts for select to authenticated using (true);
drop policy if exists counts_ins on public.counts;
create policy counts_ins on public.counts for insert to authenticated
  with check (exists (select 1 from public.periods p
                      where p.id = period_id and public.can_write_dept(p.department)));
drop policy if exists counts_upd on public.counts;
create policy counts_upd on public.counts for update to authenticated
  using (exists (select 1 from public.periods p
                 where p.id = period_id and public.can_write_dept(p.department)))
  with check (exists (select 1 from public.periods p
                      where p.id = period_id and public.can_write_dept(p.department)));
drop policy if exists counts_del on public.counts;
create policy counts_del on public.counts for delete to authenticated using (public.is_admin());

-- purchases
drop policy if exists purchases_read on public.purchases;
create policy purchases_read on public.purchases for select to authenticated using (true);
drop policy if exists purchases_write on public.purchases;
create policy purchases_write on public.purchases for all to authenticated
  using (public.is_admin() or public.has_role(auth.uid(),'fo') or public.has_role(auth.uid(),'hsk') or public.has_role(auth.uid(),'fb'))
  with check (public.is_admin() or public.has_role(auth.uid(),'fo') or public.has_role(auth.uid(),'hsk') or public.has_role(auth.uid(),'fb'));

-- ---------- Realtime ----------
alter table public.counts  replica identity full;
alter table public.periods replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.counts;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.periods;
exception when duplicate_object then null; end $$;

-- ---------- Endurecimento aplicado depois da migração ----------
-- Tabelas de uma experiência anterior no mesmo projeto Supabase: ficam
-- guardadas, mas deixam de estar acessíveis pela API pública.
alter table if exists public.config    enable row level security;
alter table if exists public.sessoes   enable row level security;
alter table if exists public.produtos  enable row level security;
alter table if exists public.contagens enable row level security;
revoke all on public.config, public.sessoes, public.produtos, public.contagens from anon, authenticated;

-- Funções internas não devem ser chamáveis pela API REST.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.has_role(uuid, app_role) from anon, public;
revoke execute on function public.is_admin() from anon, public;
revoke execute on function public.can_write_dept(department) from anon, public;

-- =====================================================================
-- Encomendas: só o que chega dentro do período conta para o consumo
-- =====================================================================
alter table public.purchases
  add column if not exists supplier text,
  add column if not exists note text,
  add column if not exists created_by text,
  add column if not exists received_by text;

create index if not exists purchases_pendentes_idx
  on public.purchases (hotel_id, item_id) where received_date is null;
create index if not exists purchases_recebidas_idx
  on public.purchases (hotel_id, item_id, received_date);

-- v_counts passa a somar as encomendas recebidas dentro do período:
--   utilizado = inv_inicial + recebido + outras_entradas - inv_final
drop view if exists public.v_counts;
create view public.v_counts
with (security_invoker = true) as
with recebido as (
  select p.id as period_id, pu.item_id,
         sum(pu.qty) as qty, sum(pu.amount_paid_eur) as valor
  from public.purchases pu
  join public.items i   on i.id = pu.item_id
  join public.periods p on p.hotel_id = pu.hotel_id and p.department = i.department
                       and pu.received_date between p.start_date and p.end_date
  group by p.id, pu.item_id
)
select
  c.id, p.hotel_id, h.slug as hotel_slug, h.name as hotel_name,
  p.department, p.kind, p.id as period_id, p.start_date, p.end_date, p.label,
  p.occupied_rooms, p.status,
  i.id as item_id, i.name as item_name, i.ref, i.category, i.supplier, i.unit, i.par_qty,
  coalesce(c.unit_price_eur, i.unit_price_eur) as unit_price_eur,
  c.opening_qty, c.purchased_qty,
  coalesce(r.qty, 0) as received_qty,
  c.purchased_qty + coalesce(r.qty, 0) as entradas_qty,
  c.amount_paid_eur + coalesce(r.valor, 0) as amount_paid_eur,
  c.closing_qty, c.quebras, c.motivo, c.comentario,
  (c.opening_qty + c.purchased_qty + coalesce(r.qty,0) - c.closing_qty) as used_qty,
  case when coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else (c.opening_qty + c.purchased_qty + coalesce(r.qty,0) - c.closing_qty)
            * coalesce(c.unit_price_eur, i.unit_price_eur) end as cost_used_eur,
  case when coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else c.closing_qty * coalesce(c.unit_price_eur, i.unit_price_eur) end as stock_value_eur,
  case when p.occupied_rooms is null or p.occupied_rooms = 0 then null
       else (c.opening_qty + c.purchased_qty + coalesce(r.qty,0) - c.closing_qty)
            / p.occupied_rooms end as used_per_room,
  case when p.occupied_rooms is null or p.occupied_rooms = 0
         or coalesce(c.unit_price_eur, i.unit_price_eur) is null then null
       else ((c.opening_qty + c.purchased_qty + coalesce(r.qty,0) - c.closing_qty)
            * coalesce(c.unit_price_eur, i.unit_price_eur)) / p.occupied_rooms
  end as cost_per_room_eur,
  c.updated_at, c.updated_by
from public.counts c
join public.periods p on p.id = c.period_id
join public.hotels  h on h.id = p.hotel_id
join public.items   i on i.id = c.item_id
left join recebido  r on r.period_id = p.id and r.item_id = c.item_id;

-- Apoio ao ecrã de encomendas: stock atual, por chegar e sugestão de compra
create or replace view public.v_stock_atual
with (security_invoker = true) as
select
  i.id as item_id, i.name as item_name, i.department, i.unit, i.par_qty,
  i.unit_price_eur, h.id as hotel_id, h.slug as hotel_slug,
  ultima.closing_qty as stock_atual, ultima.start_date as contado_em,
  coalesce(pend.qty, 0) as por_chegar,
  case when i.par_qty is null then null
       else greatest(i.par_qty - coalesce(ultima.closing_qty,0) - coalesce(pend.qty,0), 0)
  end as sugerido
from public.items i
join public.hotels h on h.id = i.hotel_id
left join lateral (
  select c.closing_qty, p.start_date
  from public.counts c join public.periods p on p.id = c.period_id
  where c.item_id = i.id and p.hotel_id = h.id and c.closing_counted
  order by p.start_date desc limit 1
) ultima on true
left join lateral (
  select sum(pu.qty) as qty from public.purchases pu
  where pu.item_id = i.id and pu.hotel_id = h.id and pu.received_date is null
) pend on true
where i.active and i.department in ('FO','HSK');

drop policy if exists purchases_write on public.purchases;
create policy purchases_ins on public.purchases for insert to authenticated
  with check (exists (select 1 from public.items i
                      where i.id = item_id and public.can_write_dept(i.department)));
create policy purchases_upd on public.purchases for update to authenticated
  using (exists (select 1 from public.items i
                 where i.id = item_id and public.can_write_dept(i.department)))
  with check (exists (select 1 from public.items i
                      where i.id = item_id and public.can_write_dept(i.department)));
create policy purchases_del on public.purchases for delete to authenticated
  using (exists (select 1 from public.items i
                 where i.id = item_id and public.can_write_dept(i.department)));

alter table public.purchases replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.purchases;
exception when duplicate_object then null; end $$;
