-- ============================================================================
-- 0004 手表配对与数据接口 (可重复执行)
--
-- 目标: vivo Watch 3 上的蓝河应用不做账号登录 —— 手表上输密码是灾难。
--       改用「配对码」: 网页生成 6 位数字码 (10 分钟有效),
--       手表输入一次换取长期 token, 之后再不用登录。
--
-- 安全设计:
--   1. token 只在兑换时明文返回一次, 数据库只存 sha256 摘要
--   2. 手表侧接口全部走 security definer 函数, 用现有 anon key 即可调用,
--      不需要把 service_role key 发到手表上 (那等于把整个库交出去)
--   3. 每个函数第一步都是拿 token 换 user_id, 换不到直接抛错
--   4. 配对码一次性使用, 用过即作废
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 配对码
-- ----------------------------------------------------------------------------
create table if not exists public.watch_pairing_codes (
  code        text primary key,                       -- 6 位数字
  user_id     uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,                            -- 非空 = 已用掉
  created_at  timestamptz not null default now()
);

create index if not exists idx_watch_pairing_user
  on public.watch_pairing_codes (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. 已配对的手表设备
-- ----------------------------------------------------------------------------
create table if not exists public.watch_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,                  -- sha256(token) 的十六进制
  name         text not null default 'vivo Watch 3',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists idx_watch_devices_user
  on public.watch_devices (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. RLS: 网页端只能看自己的配对码和设备; 手表侧走 definer 函数, 不直连表
-- ----------------------------------------------------------------------------
alter table public.watch_pairing_codes enable row level security;
alter table public.watch_devices       enable row level security;

drop policy if exists "wpc_all_own" on public.watch_pairing_codes;
create policy "wpc_all_own" on public.watch_pairing_codes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "wd_all_own" on public.watch_devices;
create policy "wd_all_own" on public.watch_devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. 内部工具: token -> user_id
--    sha256() 是 PostgreSQL 11+ 内置函数, 不依赖 pgcrypto 扩展
-- ----------------------------------------------------------------------------
create or replace function public.watch_uid_from_token(p_token text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid token';
  end if;

  select user_id into uid
  from public.watch_devices
  where token_hash = encode(sha256(p_token::bytea), 'hex');

  if uid is null then
    raise exception 'unpaired';       -- 手表侧据此提示重新配对
  end if;

  update public.watch_devices
     set last_seen_at = now()
   where token_hash = encode(sha256(p_token::bytea), 'hex');

  return uid;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 网页端: 生成配对码 (调用者身份, auth.uid() 生效)
--    同一用户重复生成时, 旧的未使用码立即作废, 避免多个码同时有效
-- ----------------------------------------------------------------------------
create or replace function public.watch_create_pairing_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security invoker
as $$
declare
  new_code text;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- 作废该用户此前未使用的码
  update public.watch_pairing_codes
     set used_at = now()
   where user_id = uid and used_at is null;

  -- 生成一个未被占用的 6 位码
  loop
    new_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from public.watch_pairing_codes c
      where c.code = new_code and c.used_at is null and c.expires_at > now()
    );
  end loop;

  insert into public.watch_pairing_codes (code, user_id, expires_at)
  values (new_code, uid, now() + interval '10 minutes');

  return query select new_code, (now() + interval '10 minutes')::timestamptz;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. 手表端: 用配对码换 token (匿名可调)
-- ----------------------------------------------------------------------------
create or replace function public.watch_redeem_pairing_code(p_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid;
  new_token text;
begin
  select user_id into uid
  from public.watch_pairing_codes
  where code = p_code
    and used_at is null
    and expires_at > now();

  if uid is null then
    raise exception 'code invalid or expired';
  end if;

  update public.watch_pairing_codes
     set used_at = now()
   where code = p_code;

  -- 256 bit 随机 token, 明文只在此处返回一次
  new_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');

  insert into public.watch_devices (user_id, token_hash)
  values (uid, encode(sha256(new_token::bytea), 'hex'));

  return new_token;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. 手表端: 取某一天的训练计划 + 每个动作的上次记录 + 今日已完成情况
--
--    p_weekday 传 null = 按 Asia/Shanghai 的今天自动判断 (isodow: 1=周一..7=周日)
--    传 1..7 = 手动切换到指定训练日 (实际健身常常会调训练日)
-- ----------------------------------------------------------------------------
create or replace function public.watch_get_today(p_token text, p_weekday int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := public.watch_uid_from_token(p_token);
  today date := (now() at time zone 'Asia/Shanghai')::date;
  wd int := coalesce(p_weekday, extract(isodow from (now() at time zone 'Asia/Shanghai'))::int);
  day_row record;
  result jsonb;
begin
  select d.id, d.title, d.weekday into day_row
  from public.plan_days d
  join public.workout_plans p on p.id = d.plan_id
  where d.user_id = uid and p.is_active and d.weekday = wd
  limit 1;

  if day_row.id is null then
    return jsonb_build_object(
      'date', today, 'weekday', wd, 'title', null,
      'exercises', '[]'::jsonb, 'done_count', 0, 'total_count', 0
    );
  end if;

  select jsonb_build_object(
    'date', today,
    'weekday', wd,
    'title', day_row.title,
    'exercises', coalesce(jsonb_agg(x.item order by x.sort_order), '[]'::jsonb),
    'done_count', count(*) filter (where x.done),
    'total_count', count(*)
  ) into result
  from (
    select
      e.sort_order,
      (l.id is not null) as done,
      jsonb_build_object(
        'id',          e.id,
        'exercise',    e.exercise,
        'target_sets', e.target_sets,
        'rep_min',     e.rep_min,
        'rep_max',     e.rep_max,
        'rir_min',     e.rir_min,
        'rir_max',     e.rir_max,
        'rest',        e.rest,
        'cues',        e.cues,
        'equipment',   e.equipment,
        -- 上次做这个动作的数据, 手表上用来预填, 省得每次从 0 转表冠
        'last_weight_kg', v.last_weight_kg,
        'last_sets',      v.last_sets,
        'last_reps',      v.last_reps,
        'last_rir',       v.last_rir,
        -- 今天是否已记录 (完成状态由 workout_logs 推导, 不额外存表)
        'done',           (l.id is not null),
        'done_weight_kg', l.weight_kg,
        'done_sets',      l.sets,
        'done_reps',      l.reps,
        'done_rir',       l.rir
      ) as item
    from public.plan_exercises e
    left join public.v_exercise_last v
      on v.user_id = uid and v.exercise = e.exercise
    left join lateral (
      select w.id, w.weight_kg, w.sets, w.reps, w.rir
      from public.workout_logs w
      where w.user_id = uid and w.date = today and w.exercise = e.exercise
      order by w.created_at desc
      limit 1
    ) l on true
    where e.day_id = day_row.id and e.user_id = uid
  ) x;

  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. 手表端: 批量提交训练记录 (支持离线补传)
--
--    同一天同一动作重复提交 = 更新而非新增, 手表反复打勾不会产生脏数据。
--    p_logs 形如:
--      [{"exercise":"卧推","weight_kg":60,"sets":4,"reps":8,"rir":2,
--        "workout_day":"推日","date":"2026-08-13"}]
--    date 可省略, 省略时用服务端的今天 (Asia/Shanghai)。
-- ----------------------------------------------------------------------------
create or replace function public.watch_submit_logs(p_token text, p_logs jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := public.watch_uid_from_token(p_token);
  today date := (now() at time zone 'Asia/Shanghai')::date;
  rec jsonb;
  d date;
  existing_id uuid;
  n int := 0;
begin
  if jsonb_typeof(p_logs) <> 'array' then
    raise exception 'p_logs must be a json array';
  end if;

  for rec in select * from jsonb_array_elements(p_logs)
  loop
    d := coalesce((rec->>'date')::date, today);

    select id into existing_id
    from public.workout_logs
    where user_id = uid and date = d and exercise = (rec->>'exercise')
    order by created_at desc
    limit 1;

    if existing_id is not null then
      update public.workout_logs
         set weight_kg   = nullif(rec->>'weight_kg','')::numeric,
             sets        = nullif(rec->>'sets','')::int,
             reps        = nullif(rec->>'reps','')::int,
             rir         = nullif(rec->>'rir','')::int,
             workout_day = coalesce(nullif(rec->>'workout_day',''), workout_day)
       where id = existing_id;
    else
      insert into public.workout_logs
        (user_id, date, workout_day, exercise, weight_kg, sets, reps, rir, notes)
      values (
        uid, d,
        nullif(rec->>'workout_day',''),
        rec->>'exercise',
        nullif(rec->>'weight_kg','')::numeric,
        nullif(rec->>'sets','')::int,
        nullif(rec->>'reps','')::int,
        nullif(rec->>'rir','')::int,
        nullif(rec->>'notes','')
      );
    end if;

    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'written', n);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. 授权: 手表用 anon key 调用这三个函数
--    其余表依旧受 RLS 保护, anon 直接查表拿不到任何数据
-- ----------------------------------------------------------------------------
grant execute on function public.watch_redeem_pairing_code(text) to anon, authenticated;
grant execute on function public.watch_get_today(text, int)      to anon, authenticated;
grant execute on function public.watch_submit_logs(text, jsonb)  to anon, authenticated;
grant execute on function public.watch_create_pairing_code()     to authenticated;

-- 内部函数不对外暴露
revoke execute on function public.watch_uid_from_token(text) from anon, authenticated;

-- ============================================================================
-- 完成
-- ============================================================================
