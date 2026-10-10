-- migration-safety: allow-destructive reason=replace_role_check_preserving_existing_values_and_adding_employee
begin;
-- Learning job roles never confer application permissions. Keep every old role.
alter table public.admin_user_profiles drop constraint admin_user_profiles_role_check;
alter table public.admin_user_profiles add constraint admin_user_profiles_role_check
  check(role in ('owner','admin','branch_manager','operator','marketer','courier','editor',
    'viewer','cashier','franchisee','iiko_dashboard','employee')) not valid;
alter table public.admin_user_profiles validate constraint admin_user_profiles_role_check;

create table public.learning_job_roles (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 240),
  description text not null default '' check(length(description)<=10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.learning_job_roles(id,title) values
  ('10000000-0000-4000-8000-000000000001','Кассир'),
  ('10000000-0000-4000-8000-000000000002','Администратор'),
  ('10000000-0000-4000-8000-000000000003','Оператор'),
  ('10000000-0000-4000-8000-000000000004','Пекарь'),
  ('10000000-0000-4000-8000-000000000005','Управляющий'),
  ('10000000-0000-4000-8000-000000000006','Продавец');

create table public.learning_employee_profiles (
  username text primary key references public.admin_user_profiles(username) on update cascade,
  job_role_id uuid references public.learning_job_roles(id),
  start_date date check(start_date is null or (start_date>='1900-01-01'
    and start_date<=(clock_timestamp() at time zone 'Asia/Almaty')::date)),
  learning_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.learning_employee_profiles.start_date is
  'Administrator-reviewed employment start date. Never inferred from account creation.';

create table public.learning_courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 240),
  description text not null default '' check(length(description)<=10000),
  role_ids uuid[] not null default '{}',
  published boolean not null default false,
  modules jsonb not null default '[]' check(jsonb_typeof(modules)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.learning_assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 240),
  description text not null default '' check(length(description)<=10000),
  kind text not null check(kind in ('practice','control','promotion')),
  role_ids uuid[] not null default '{}',
  published boolean not null default false,
  question_count integer not null default 5 check(question_count between 1 and 100),
  max_attempts integer not null default 3 check(max_attempts between 1 and 100),
  pass_percent integer not null default 80 check(pass_percent between 1 and 100),
  time_limit_minutes integer not null default 30 check(time_limit_minutes between 1 and 1440),
  cooldown_minutes integer not null default 0 check(cooldown_minutes between 0 and 525600),
  minimum_tenure_days integer not null default 0 check(minimum_tenure_days between 0 and 36500),
  required_course_ids uuid[] not null default '{}',
  target_role_id uuid references public.learning_job_roles(id),
  questions jsonb not null default '[]' check(jsonb_typeof(questions)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((kind='promotion' and target_role_id is not null) or (kind<>'promotion' and target_role_id is null))
);
create table public.learning_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_username text references public.admin_user_profiles(username) on update cascade,
  role_id uuid references public.learning_job_roles(id),
  course_id uuid references public.learning_courses(id),
  assessment_id uuid references public.learning_assessments(id),
  required boolean not null default true,
  due_at timestamptz,
  created_by text not null check(length(btrim(created_by)) between 1 and 160),
  created_at timestamptz not null default now(),
  check((employee_username is not null)::integer+(role_id is not null)::integer=1),
  check((course_id is not null)::integer+(assessment_id is not null)::integer=1)
);
create index learning_assignments_employee on public.learning_assignments(employee_username);
create index learning_assignments_role on public.learning_assignments(role_id);

create table public.learning_lesson_progress (
  username text not null references public.learning_employee_profiles(username) on update cascade,
  lesson_id uuid not null,
  course_id uuid not null references public.learning_courses(id),
  completed_at timestamptz not null default now(),
  primary key(username,lesson_id)
);
create index learning_lesson_progress_course on public.learning_lesson_progress(username,course_id);
create table public.learning_achievements (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.learning_employee_profiles(username) on update cascade,
  code text not null check(length(code) between 1 and 160),
  title text not null check(length(btrim(title)) between 1 and 240),
  xp integer not null check(xp between 0 and 10000),
  earned_at timestamptz not null default now(),
  unique(username,code)
);
create table public.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.learning_employee_profiles(username) on update cascade,
  assessment_id uuid not null references public.learning_assessments(id),
  title text not null,
  kind text not null check(kind in ('practice','control','promotion')),
  status text not null default 'in_progress' check(status in ('in_progress','submitted','expired')),
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  pass_percent integer not null check(pass_percent between 1 and 100),
  score_percent numeric(5,2) check(score_percent between 0 and 100),
  passed boolean,
  questions jsonb not null check(jsonb_typeof(questions)='array'),
  answers jsonb check(answers is null or jsonb_typeof(answers)='array'),
  correct_count integer check(correct_count between 0 and question_count),
  question_count integer not null check(question_count between 1 and 100),
  xp_awarded integer not null default 0 check(xp_awarded in (0,20,50,100)),
  target_role_id uuid references public.learning_job_roles(id),
  promotion_decision text check(promotion_decision in ('approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  check(deadline_at>started_at),
  check(jsonb_array_length(questions)=question_count),
  check((status='submitted' and submitted_at is not null and score_percent is not null
    and passed is not null and correct_count is not null and answers is not null)
    or (status<>'submitted' and submitted_at is null and score_percent is null and passed is null
      and correct_count is null and answers is null and xp_awarded=0)),
  check((promotion_decision is null and decided_by is null and decided_at is null)
    or (promotion_decision is not null and status='submitted' and passed and kind='promotion'
      and target_role_id is not null and nullif(btrim(decided_by),'') is not null and decided_at is not null))
);
comment on column public.learning_attempts.questions is
  'Private immutable grading snapshot; learner JSON must omit correctChoiceId and explanation.';
create index learning_attempts_history on public.learning_attempts(username,assessment_id,started_at desc);
create unique index learning_attempts_one_active on public.learning_attempts(username,assessment_id)
  where status='in_progress';

-- Service reads are backend-only. Accrued results can be changed only by RPCs.
do $$ declare t text; begin
  foreach t in array array['learning_job_roles','learning_employee_profiles','learning_courses',
    'learning_assessments','learning_assignments','learning_lesson_progress','learning_achievements','learning_attempts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to service_role using(true)',t||'_service_read',t);
  end loop;
end $$;
grant insert,update on public.learning_job_roles,public.learning_employee_profiles,
  public.learning_courses,public.learning_assessments to service_role;
grant insert,update,delete on public.learning_assignments to service_role;

create function public.learning_touch_updated_at() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['learning_job_roles','learning_employee_profiles','learning_courses','learning_assessments'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.learning_touch_updated_at()',t||'_touch',t);
  end loop;
end $$;

create function public.learning_course_lessons(p_modules jsonb)
returns table(lesson_id uuid,module_order integer,lesson_order integer) language sql immutable
set search_path=public,pg_temp as $$
  select (l->>'id')::uuid,(m->>'sortOrder')::integer,(l->>'sortOrder')::integer
  from jsonb_array_elements(p_modules) m cross join lateral jsonb_array_elements(m->'lessons') l;
$$;
create function public.learning_validate_content() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; lesson jsonb; choice jsonb; ids text[]:='{}'; module_ids text[]:='{}'; choice_ids text[];
  uuid_pattern text:='^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
begin
  if array_position(new.role_ids,null) is not null
    or cardinality(new.role_ids)<>(select count(distinct r) from unnest(new.role_ids) r)
    or exists(select 1 from unnest(new.role_ids) r where not exists(select 1 from learning_job_roles j where j.id=r)) then
    raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT';
  end if;
  if tg_table_name='learning_courses' then
    if jsonb_typeof(new.modules) is distinct from 'array' or jsonb_array_length(new.modules)>100 then
      raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
    for item in select value from jsonb_array_elements(new.modules) loop
      if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','')!~uuid_pattern
        or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 240
        or coalesce(item->>'sortOrder','')!~'^[0-9]{1,6}$'
        or jsonb_typeof(item->'lessons') is distinct from 'array' or jsonb_array_length(item->'lessons')>1000 then
        raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
      if lower(item->>'id')=any(module_ids) then raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
      module_ids:=array_append(module_ids,lower(item->>'id'));
      for lesson in select value from jsonb_array_elements(item->'lessons') loop
        if jsonb_typeof(lesson) is distinct from 'object' or coalesce(lesson->>'id','')!~uuid_pattern
          or jsonb_typeof(lesson->'title') is distinct from 'string' or length(btrim(lesson->>'title')) not between 1 and 240
          or jsonb_typeof(lesson->'body') is distinct from 'string' or length(lesson->>'body')>100000
          or (lesson->>'videoUrl' is not null and lesson->>'videoUrl'!~'^https://[^[:space:]]+$')
          or coalesce(lesson->>'estimatedMinutes','')!~'^[0-9]{1,4}$'
          or (lesson->>'estimatedMinutes')::integer>1440 or coalesce(lesson->>'sortOrder','')!~'^[0-9]{1,6}$' then
          raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
        if lower(lesson->>'id')=any(ids) then raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
        ids:=array_append(ids,lower(lesson->>'id'));
      end loop;
    end loop;
    if cardinality(ids)>1000 or (new.published and cardinality(ids)=0)
      or exists(select 1 from learning_courses c cross join lateral learning_course_lessons(c.modules) l
        where c.id<>new.id and l.lesson_id::text=any(ids))
      or exists(select 1 from learning_lesson_progress p where p.course_id<>new.id and p.lesson_id::text=any(ids)) then
      raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
  else
    if array_position(new.required_course_ids,null) is not null
      or cardinality(new.required_course_ids)<>(select count(distinct r) from unnest(new.required_course_ids) r)
      or exists(select 1 from unnest(new.required_course_ids) r where not exists(select 1 from learning_courses c where c.id=r))
      or jsonb_typeof(new.questions) is distinct from 'array' or jsonb_array_length(new.questions)>1000
      or (new.published and jsonb_array_length(new.questions)<new.question_count) then
      raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
    for item in select value from jsonb_array_elements(new.questions) loop
      if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','')!~uuid_pattern
        or jsonb_typeof(item->'prompt') is distinct from 'string' or length(btrim(item->>'prompt')) not between 1 and 10000
        or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_array_length(item->'choices') not between 2 and 10
        or coalesce(item->>'correctChoiceId','')!~uuid_pattern
        or jsonb_typeof(item->'explanation') is distinct from 'string' or length(item->>'explanation')>10000 then
        raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
      if lower(item->>'id')=any(ids) then raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
      ids:=array_append(ids,lower(item->>'id')); choice_ids:='{}';
      for choice in select value from jsonb_array_elements(item->'choices') loop
        if jsonb_typeof(choice) is distinct from 'object' or coalesce(choice->>'id','')!~uuid_pattern
          or jsonb_typeof(choice->'text') is distinct from 'string' or length(btrim(choice->>'text')) not between 1 and 10000
          or lower(choice->>'id')=any(choice_ids) then
          raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
        choice_ids:=array_append(choice_ids,lower(choice->>'id'));
      end loop;
      if not lower(item->>'correctChoiceId')=any(choice_ids) then
        raise exception using errcode='23514',message='LEARNING_INVALID_CONTENT'; end if;
    end loop;
  end if;
  return new;
end $$;
create trigger learning_courses_content before insert or update on public.learning_courses
  for each row execute function public.learning_validate_content();
create trigger learning_assessments_content before insert or update on public.learning_assessments
  for each row execute function public.learning_validate_content();

create function public.learning_learner_error(p_username text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p learning_employee_profiles%rowtype; account_active boolean;
begin
  select active into account_active from admin_user_profiles where username=p_username;
  if account_active is distinct from true then return 'LEARNING_ACCOUNT_INACTIVE'; end if;
  select * into p from learning_employee_profiles where username=p_username;
  if not found or not p.learning_enabled then return 'LEARNING_ACCESS_DISABLED'; end if;
  if p.job_role_id is not null and not exists(select 1 from learning_job_roles where id=p.job_role_id and active) then
    return 'LEARNING_ROLE_INACTIVE'; end if;
  return null;
end $$;
create function public.learning_has_access(p_username text,p_roles uuid[],p_course uuid,p_assessment uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select cardinality(p_roles)=0 or p.job_role_id=any(p_roles) or exists(
    select 1 from learning_assignments a where
      (a.employee_username=p_username or a.role_id=p.job_role_id)
      and ((p_course is not null and a.course_id=p_course) or (p_assessment is not null and a.assessment_id=p_assessment))
  ) from learning_employee_profiles p where p.username=p_username;
$$;
create function public.learning_course_complete(p_username text,p_course uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from learning_course_lessons(c.modules)) and not exists(
    select 1 from learning_course_lessons(c.modules) l where not exists(
      select 1 from learning_lesson_progress p where p.username=p_username and p.course_id=c.id and p.lesson_id=l.lesson_id
    )
  ) from learning_courses c where c.id=p_course;
$$;
create function public.learning_award(p_username text,p_code text,p_title text,p_xp integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into learning_achievements(username,code,title,xp,earned_at)
    values(p_username,p_code,left(p_title,240),p_xp,clock_timestamp()) on conflict(username,code) do nothing;
  return case when found then p_xp else 0 end;
end $$;

create function public.learning_complete_lesson(p_username text,p_lesson_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c learning_courses%rowtype; lesson record; error_code text; found_lesson boolean:=false;
begin
  perform 1 from learning_employee_profiles where username=p_username for update;
  error_code:=learning_learner_error(p_username);
  if error_code is not null then return jsonb_build_object('error',error_code); end if;
  select course.* into c from learning_courses course where exists(
    select 1 from learning_course_lessons(course.modules) l where l.lesson_id=p_lesson_id
  ) for share;
  if not found then return jsonb_build_object('error','LEARNING_LESSON_NOT_FOUND'); end if;
  if not c.published or learning_has_access(p_username,c.role_ids,c.id,null) is distinct from true then
    return jsonb_build_object('error','LEARNING_COURSE_UNAVAILABLE'); end if;
  if exists(select 1 from learning_lesson_progress where username=p_username and lesson_id=p_lesson_id and course_id=c.id) then
    return jsonb_build_object('ok',true); end if;
  for lesson in select * from learning_course_lessons(c.modules) order by module_order,lesson_order,lesson_id loop
    if lesson.lesson_id=p_lesson_id then found_lesson:=true; exit; end if;
    if not exists(select 1 from learning_lesson_progress where username=p_username and lesson_id=lesson.lesson_id and course_id=c.id) then
      return jsonb_build_object('error','LEARNING_LESSON_LOCKED'); end if;
  end loop;
  if not found_lesson then return jsonb_build_object('error','LEARNING_LESSON_NOT_FOUND'); end if;
  insert into learning_lesson_progress(username,lesson_id,course_id,completed_at)
    values(p_username,p_lesson_id,c.id,clock_timestamp());
  perform learning_award(p_username,'lesson:'||p_lesson_id::text,'Урок завершён',10);
  if learning_course_complete(p_username,c.id) then
    perform learning_award(p_username,'course:'||c.id::text,'Курс завершён: '||c.title,50); end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.learning_start_attempt(p_username text,p_assessment_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare profile learning_employee_profiles%rowtype; assessment learning_assessments%rowtype;
  attempt learning_attempts%rowtype; error_code text; at_time timestamptz; latest_end timestamptz; snapshot jsonb;
begin
  select * into profile from learning_employee_profiles where username=p_username for update;
  error_code:=learning_learner_error(p_username);
  if error_code is not null then return jsonb_build_object('error',error_code); end if;
  select * into assessment from learning_assessments where id=p_assessment_id for share;
  if not found or not assessment.published or learning_has_access(p_username,assessment.role_ids,null,assessment.id) is distinct from true then
    return jsonb_build_object('error','LEARNING_ASSESSMENT_UNAVAILABLE'); end if;
  -- Read wall-clock time after locks, never a browser time or transaction-start time.
  at_time:=clock_timestamp();
  if assessment.target_role_id is not null and not exists(select 1 from learning_job_roles where id=assessment.target_role_id and active) then
    return jsonb_build_object('error','LEARNING_TARGET_ROLE_INACTIVE'); end if;
  if assessment.minimum_tenure_days>0 and (profile.start_date is null
    or (at_time at time zone 'Asia/Almaty')::date-profile.start_date<assessment.minimum_tenure_days) then
    return jsonb_build_object('error','LEARNING_TENURE_REQUIRED'); end if;
  if exists(select 1 from unnest(assessment.required_course_ids) course_id
    where learning_course_complete(p_username,course_id) is distinct from true) then
    return jsonb_build_object('error','LEARNING_PREREQUISITES'); end if;
  update learning_attempts set status='expired' where username=p_username and assessment_id=p_assessment_id
    and status='in_progress' and deadline_at<=at_time;
  select * into attempt from learning_attempts where username=p_username and assessment_id=p_assessment_id and status='in_progress';
  if found then return jsonb_build_object('attemptId',attempt.id); end if;
  if (select count(*) from learning_attempts where username=p_username and assessment_id=p_assessment_id)>=assessment.max_attempts then
    return jsonb_build_object('error','LEARNING_MAX_ATTEMPTS'); end if;
  select max(coalesce(submitted_at,deadline_at)) into latest_end from learning_attempts
    where username=p_username and assessment_id=p_assessment_id;
  if latest_end is not null and latest_end+make_interval(mins=>assessment.cooldown_minutes)>at_time then
    return jsonb_build_object('error','LEARNING_COOLDOWN'); end if;
  select jsonb_agg(question order by position) into snapshot from (
    select question,row_number() over() position from (
      select value question from jsonb_array_elements(assessment.questions) order by random() limit assessment.question_count
    ) sampled
  ) ordered;
  if snapshot is null or jsonb_array_length(snapshot)<>assessment.question_count then
    return jsonb_build_object('error','LEARNING_ASSESSMENT_UNAVAILABLE'); end if;
  insert into learning_attempts(username,assessment_id,title,kind,started_at,deadline_at,pass_percent,questions,question_count,target_role_id)
    values(p_username,assessment.id,assessment.title,assessment.kind,at_time,
      at_time+make_interval(mins=>assessment.time_limit_minutes),assessment.pass_percent,snapshot,assessment.question_count,assessment.target_role_id)
    returning * into attempt;
  return jsonb_build_object('attemptId',attempt.id);
end $$;

create function public.learning_submit_attempt(p_username text,p_attempt_id uuid,p_answers jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare attempt learning_attempts%rowtype; error_code text; at_time timestamptz;
  answer jsonb; canonical jsonb; correct integer; score numeric; is_passed boolean; xp integer:=0;
  uuid_pattern text:='^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
begin
  perform 1 from learning_employee_profiles where username=p_username for update;
  error_code:=learning_learner_error(p_username);
  if error_code is not null then return jsonb_build_object('error',error_code); end if;
  select * into attempt from learning_attempts where id=p_attempt_id and username=p_username for update;
  if not found then return jsonb_build_object('error','LEARNING_ATTEMPT_NOT_FOUND'); end if;
  at_time:=clock_timestamp();
  if attempt.status='expired' or (attempt.status='in_progress' and attempt.deadline_at<=at_time) then
    update learning_attempts set status='expired' where id=attempt.id and status='in_progress';
    return jsonb_build_object('error','LEARNING_ATTEMPT_EXPIRED'); end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)<>attempt.question_count then
    return jsonb_build_object('error','LEARNING_INVALID_ANSWERS'); end if;
  for answer in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(answer) is distinct from 'object' or coalesce(answer->>'questionId','')!~uuid_pattern
      or coalesce(answer->>'choiceId','')!~uuid_pattern
      or (select count(*) from jsonb_object_keys(answer))<>2 then
      return jsonb_build_object('error','LEARNING_INVALID_ANSWERS'); end if;
  end loop;
  if (select count(distinct lower(value->>'questionId')) from jsonb_array_elements(p_answers))<>attempt.question_count then
    return jsonb_build_object('error','LEARNING_INVALID_ANSWERS'); end if;
  select jsonb_agg(jsonb_build_object('questionId',lower(value->>'questionId'),'choiceId',lower(value->>'choiceId'))
    order by lower(value->>'questionId')) into canonical from jsonb_array_elements(p_answers);
  if exists(select 1 from jsonb_array_elements(canonical) a where not exists(
    select 1 from jsonb_array_elements(attempt.questions) q cross join lateral jsonb_array_elements(q->'choices') c
      where lower(q->>'id')=a->>'questionId' and lower(c->>'id')=a->>'choiceId'
  )) then return jsonb_build_object('error','LEARNING_INVALID_ANSWERS'); end if;
  if attempt.status='submitted' then
    if attempt.answers is distinct from canonical then return jsonb_build_object('error','LEARNING_SUBMISSION_CONFLICT'); end if;
    return jsonb_build_object('attemptId',attempt.id); end if;
  select count(*)::integer into correct from jsonb_array_elements(attempt.questions) q
    join jsonb_array_elements(canonical) a on lower(q->>'id')=a->>'questionId'
    where lower(q->>'correctChoiceId')=a->>'choiceId';
  score:=round(100.0*correct/attempt.question_count,2);
  is_passed:=100.0*correct>=attempt.pass_percent*attempt.question_count;
  if is_passed then
    xp:=learning_award(p_username,'assessment:'||attempt.assessment_id::text,'Тест сдан: '||attempt.title,
      case attempt.kind when 'practice' then 20 when 'control' then 50 else 100 end); end if;
  update learning_attempts set status='submitted',submitted_at=at_time,answers=canonical,correct_count=correct,
    score_percent=score,passed=is_passed,xp_awarded=xp where id=attempt.id;
  return jsonb_build_object('attemptId',attempt.id);
end $$;

create function public.learning_decide_promotion(p_attempt_id uuid,p_decision text,p_actor text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare attempt learning_attempts%rowtype; employee_username text; actor admin_user_profiles%rowtype;
  employee admin_user_profiles%rowtype;
begin
  if p_decision is null or p_decision not in ('approved','rejected') or p_actor is null
    or length(btrim(p_actor)) not between 1 and 160 then
    return jsonb_build_object('error','LEARNING_INVALID_DECISION'); end if;
  select username into employee_username from learning_attempts where id=p_attempt_id;
  if not found then return jsonb_build_object('error','LEARNING_ATTEMPT_NOT_FOUND'); end if;
  perform 1 from learning_employee_profiles where username=employee_username for update;
  select * into attempt from learning_attempts where id=p_attempt_id for update;
  select * into employee from admin_user_profiles where username=employee_username;
  if employee.active is distinct from true then return jsonb_build_object('error','LEARNING_ACCOUNT_INACTIVE'); end if;
  select * into actor from admin_user_profiles where username=p_actor;
  -- An environment owner has no profile row; service-only RPC trusts the authenticated server actor.
  if found and (not actor.active or actor.role not in ('owner','admin','branch_manager')
    or (actor.role='branch_manager' and (cardinality(employee.branch_ids)=0
      or not employee.branch_ids<@actor.branch_ids))) then
    return jsonb_build_object('error','LEARNING_PROMOTION_FORBIDDEN'); end if;
  if attempt.kind<>'promotion' or attempt.status<>'submitted' or attempt.passed is distinct from true
    or attempt.target_role_id is null then return jsonb_build_object('error','LEARNING_PROMOTION_CONFLICT'); end if;
  if attempt.promotion_decision is not null then
    if attempt.promotion_decision<>p_decision then return jsonb_build_object('error','LEARNING_PROMOTION_CONFLICT'); end if;
    return jsonb_build_object('attemptId',attempt.id,'username',attempt.username); end if;
  if p_decision='approved' then
    if not exists(select 1 from learning_job_roles where id=attempt.target_role_id and active) then
      return jsonb_build_object('error','LEARNING_TARGET_ROLE_INACTIVE'); end if;
    update learning_employee_profiles set job_role_id=attempt.target_role_id where username=attempt.username;
    perform learning_award(attempt.username,'promotion:'||attempt.target_role_id::text,'Повышение подтверждено',0);
  end if;
  update learning_attempts set promotion_decision=p_decision,decided_by=p_actor,decided_at=clock_timestamp() where id=attempt.id;
  return jsonb_build_object('attemptId',attempt.id,'username',attempt.username);
end $$;

-- PostgreSQL grants PUBLIC execute by default; revoke every new helper as well.
revoke all on function public.learning_touch_updated_at(),public.learning_course_lessons(jsonb),
  public.learning_validate_content(),public.learning_learner_error(text),
  public.learning_has_access(text,uuid[],uuid,uuid),public.learning_course_complete(text,uuid),
  public.learning_award(text,text,text,integer),public.learning_complete_lesson(text,uuid),
  public.learning_start_attempt(text,uuid),public.learning_submit_attempt(text,uuid,jsonb),
  public.learning_decide_promotion(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learning_complete_lesson(text,uuid),public.learning_start_attempt(text,uuid),
  public.learning_submit_attempt(text,uuid,jsonb),public.learning_decide_promotion(uuid,text,text) to service_role;

-- Individual employee passwords reuse the isolated staff credential store.
-- This account type remains learning-only; it never receives cashier authority.
create function public.create_employee_access(
  p_username text,p_display_name text,p_branch_ids uuid[],p_password_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare username_value text:=lower(btrim(coalesce(p_username,'')));
  profile public.admin_user_profiles%rowtype;
begin
  if username_value!~'^[a-z0-9][a-z0-9._-]{2,63}$'
    or nullif(btrim(coalesce(p_display_name,'')),'') is null or length(btrim(p_display_name))>160
    or coalesce(p_password_hash,'')!~'^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception using errcode='22023',message='invalid employee credentials'; end if;
  if p_branch_ids is null or cardinality(p_branch_ids)>50 or array_position(p_branch_ids,null) is not null
    or cardinality(p_branch_ids)<>(select count(distinct id) from unnest(p_branch_ids) id)
    or exists(select 1 from unnest(p_branch_ids) branch(id) where not exists(select 1 from bulka_locations b where b.id=branch.id)) then
    raise exception using errcode='22023',message='invalid employee branches'; end if;
  insert into admin_user_profiles(username,display_name,role,branch_ids,active,updated_at)
    values(username_value,btrim(p_display_name),'employee',p_branch_ids,true,clock_timestamp())
    returning * into profile;
  insert into admin_staff_credentials(username,password_hash) values(username_value,p_password_hash);
  return jsonb_build_object('username',profile.username,'display_name',profile.display_name,
    'role',profile.role,'branch_ids',profile.branch_ids,'active',profile.active,
    'created_at',profile.created_at,'updated_at',profile.updated_at);
end $$;

create function public.update_employee_access(
  p_username text,p_display_name text,p_branch_ids uuid[],p_active boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare username_value text:=lower(btrim(coalesce(p_username,'')));
  profile public.admin_user_profiles%rowtype;
begin
  if (p_display_name is not null and (nullif(btrim(p_display_name),'') is null or length(btrim(p_display_name))>160))
    or p_branch_ids is null or cardinality(p_branch_ids)>50 or array_position(p_branch_ids,null) is not null
    or cardinality(p_branch_ids)<>(select count(distinct id) from unnest(p_branch_ids) id)
    or exists(select 1 from unnest(p_branch_ids) branch(id) where not exists(select 1 from bulka_locations b where b.id=branch.id)) then
    raise exception using errcode='22023',message='invalid employee profile'; end if;
  select * into profile from admin_user_profiles where username=username_value for update;
  if not found or profile.role<>'employee' or not exists(select 1 from admin_staff_credentials where username=username_value) then
    raise exception using errcode='22023',message='employee password account not found'; end if;
  update admin_user_profiles set display_name=coalesce(btrim(p_display_name),profile.display_name),branch_ids=p_branch_ids,
    active=coalesce(p_active,false),updated_at=clock_timestamp() where username=username_value returning * into profile;
  if coalesce(p_active,false) is false then
    update admin_staff_credentials set auth_version=auth_version+1,updated_at=clock_timestamp() where username=username_value;
    update admin_sessions set revoked_at=clock_timestamp() where admin_subject=username_value and revoked_at is null;
  end if;
  return jsonb_build_object('username',profile.username,'display_name',profile.display_name,
    'role',profile.role,'branch_ids',profile.branch_ids,'active',profile.active,
    'created_at',profile.created_at,'updated_at',profile.updated_at);
end $$;

create function public.reset_employee_password(p_username text,p_password_hash text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare username_value text:=lower(btrim(coalesce(p_username,'')));
  profile public.admin_user_profiles%rowtype;
begin
  if coalesce(p_password_hash,'')!~'^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception using errcode='22023',message='invalid employee password hash'; end if;
  select * into profile from admin_user_profiles where username=username_value for update;
  if not found or profile.role<>'employee' then
    raise exception using errcode='22023',message='employee account not found'; end if;
  update admin_staff_credentials set password_hash=p_password_hash,auth_version=auth_version+1,
    password_changed_at=clock_timestamp(),updated_at=clock_timestamp() where username=username_value;
  if not found then raise exception using errcode='22023',message='employee credentials not found'; end if;
  update admin_sessions set revoked_at=clock_timestamp() where admin_subject=username_value and revoked_at is null;
  return true;
end $$;
revoke all on function public.create_employee_access(text,text,uuid[],text),
  public.update_employee_access(text,text,uuid[],boolean),public.reset_employee_password(text,text)
  from public,anon,authenticated;
grant execute on function public.create_employee_access(text,text,uuid[],text),
  public.update_employee_access(text,text,uuid[],boolean),public.reset_employee_password(text,text) to service_role;
notify pgrst,'reload schema';
commit;
