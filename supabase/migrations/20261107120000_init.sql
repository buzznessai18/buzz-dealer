-- GrowthPilot AI initial schema, authorization, and storage.
-- Apply this file once in the Supabase SQL editor or via the Supabase CLI.
-- Workspace data is isolated by row level security. Service-role keys bypass RLS
-- and must stay on the server.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_workspace_move()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity and workspaces
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  avatar_url text,
  active_workspace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_active_workspace_fkey
  foreign key (active_workspace_id) references public.workspaces (id) on delete set null;

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);
create index profiles_email_idx on public.profiles (lower(email));

create or replace function public.is_workspace_member(p_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_ws and user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(p_ws uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_ws
      and user_id = auth.uid()
      and role = any (p_roles)
  );
$$;

create or replace function public.shares_workspace(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid() and them.user_id = p_other
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

create or replace function public.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.provision_workspace_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_profiles (workspace_id) values (new.id) on conflict (workspace_id) do nothing;
  insert into public.company_settings (workspace_id) values (new.id) on conflict (workspace_id) do nothing;
  return new;
end;
$$;

-- company tables are created below; triggers are attached after them.

create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  company_name text not null default '',
  website text,
  description text,
  location text,
  mailing_address text,
  email text,
  logo_url text,
  services jsonb not null default '[]'::jsonb,
  target_countries text[] not null default '{}',
  target_industries text[] not null default '{}',
  ideal_customer_profile jsonb not null default '{}'::jsonb,
  portfolio jsonb not null default '[]'::jsonb,
  case_studies jsonb not null default '[]'::jsonb,
  email_signature text,
  ai_provider text not null default 'openai' check (ai_provider in ('openai', 'anthropic', 'gemini')),
  ai_model text not null default 'gpt-4o-mini',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  brand_voice text not null default 'professional',
  content_language text not null default 'en',
  daily_send_limit integer not null default 50 check (daily_send_limit >= 0 and daily_send_limit <= 500),
  min_hours_between_emails integer not null default 48 check (min_hours_between_emails >= 0),
  require_manual_approval boolean not null default true,
  auto_send_replies boolean not null default false,
  compliance jsonb not null default jsonb_build_object(
    'require_lawful_basis', true,
    'allowed_countries', '[]'::jsonb,
    'include_physical_address', true,
    'include_unsubscribe', true,
    'dpdp_acknowledged', false,
    'gdpr_acknowledged', false,
    'can_spam_acknowledged', false,
    'trai_acknowledged', false
  ),
  ai_monthly_token_limit integer not null default 500000 check (ai_monthly_token_limit >= 0),
  data_retention_days integer not null default 730 check (data_retention_days >= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_add_owner
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner();

create trigger workspaces_provision_defaults
  after insert on public.workspaces
  for each row execute function public.provision_workspace_defaults();

create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if length(trim(p_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;
  insert into public.workspaces (name, slug, owner_id)
  values (trim(p_name), trim(p_slug), uid)
  returning id into ws;
  update public.profiles set active_workspace_id = ws where id = uid;
  return ws;
exception
  when unique_violation then
    raise exception 'A workspace with this address already exists';
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  category text not null default '',
  industry text not null default '',
  target_audience text not null default '',
  problem_solved text not null default '',
  features jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  tech_stack jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  demo_urls jsonb not null default '[]'::jsonb,
  website_url text,
  portfolio_urls jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  category text not null default '',
  industry text not null default '',
  target_audience text not null default '',
  problem_solved text not null default '',
  features jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  tech_stack jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  demo_urls jsonb not null default '[]'::jsonb,
  website_url text,
  portfolio_urls jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  service_id uuid references public.service_catalog (id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'video', 'document', 'case_study', 'logo')),
  title text not null default '',
  url text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (product_id is not null or service_id is not null or kind = 'logo')
);

create index products_workspace_idx on public.products (workspace_id, status);
create index service_catalog_workspace_idx on public.service_catalog (workspace_id, status);
create index product_assets_product_idx on public.product_assets (product_id);
create index product_assets_service_idx on public.product_assets (service_id);

-- ---------------------------------------------------------------------------
-- Companies, contacts, leads
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  website text,
  domain text,
  industry text,
  country text,
  city text,
  location text,
  description text,
  company_size text,
  linkedin_url text,
  public_contact jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  discovered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NULL domains stay insertable. PostgreSQL treats NULLs as distinct in unique indexes.
create unique index companies_workspace_domain_uidx
  on public.companies (workspace_id, domain);

create index companies_workspace_country_idx on public.companies (workspace_id, country);
create index companies_workspace_industry_idx on public.companies (workspace_id, industry);
create index companies_name_idx on public.companies (workspace_id, lower(name));

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text,
  designation text,
  email text,
  phone text,
  linkedin_url text,
  source text,
  is_primary boolean not null default false,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index contacts_workspace_email_uidx
  on public.contacts (workspace_id, lower(email))
  where email is not null and email <> '';

create index contacts_company_idx on public.contacts (company_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  title text,
  stage text not null default 'discovered' check (stage in (
    'new', 'discovered', 'researched', 'qualified', 'contacted', 'replied',
    'meeting_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'
  )),
  owner_id uuid references public.profiles (id) on delete set null,
  source text not null default 'manual',
  deal_value numeric(14, 2) not null default 0 check (deal_value >= 0),
  currency text,
  probability integer not null default 10 check (probability >= 0 and probability <= 100),
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  next_follow_up date,
  summary text,
  outreach_eligible boolean not null default false,
  lawful_basis text check (lawful_basis is null or lawful_basis in (
    'consent', 'existing_relationship', 'legitimate_interest_reviewed', 'other_documented'
  )),
  lawful_basis_note text,
  lawful_basis_verified_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_workspace_stage_idx on public.leads (workspace_id, stage);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
create index leads_follow_up_idx on public.leads (workspace_id, next_follow_up);
create index leads_company_idx on public.leads (company_id);

create table public.lead_research (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  overview text,
  main_offerings text,
  industry text,
  target_audience text,
  facts jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  technical_challenges jsonb not null default '[]'::jsonb,
  development_opportunities jsonb not null default '[]'::jsonb,
  automation_opportunities jsonb not null default '[]'::jsonb,
  ai_opportunities jsonb not null default '[]'::jsonb,
  recommended_services jsonb not null default '[]'::jsonb,
  recommended_product_id uuid references public.products (id) on delete set null,
  recommended_service_id uuid references public.service_catalog (id) on delete set null,
  decision_maker_titles text[] not null default '{}',
  outreach_angle text,
  product_match jsonb,
  generator text not null default 'manual' check (generator in ('manual', 'ai', 'rules')),
  model text,
  researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_research_lead_idx on public.lead_research (lead_id, created_at desc);

create table public.lead_opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  title text not null,
  opportunity_type text not null,
  business_context text not null default '',
  potential_problem text not null default '',
  recommended_solution text not null default '',
  proposed_stack jsonb not null default '[]'::jsonb,
  complexity text not null default 'medium' check (complexity in ('low', 'medium', 'high')),
  proposal_structure jsonb not null default '[]'::jsonb,
  next_step text not null default '',
  is_hypothesis boolean not null default true,
  verified boolean not null default false,
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'converted', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_opportunities_workspace_idx on public.lead_opportunities (workspace_id, status);

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  score integer not null check (score >= 0 and score <= 100),
  breakdown jsonb not null default '{}'::jsonb,
  explanation text not null default '',
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_scores_lead_idx on public.lead_scores (lead_id, scored_at desc);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  activity_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index lead_activities_workspace_idx on public.lead_activities (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Outreach
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in (
    'draft', 'approved', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'
  )),
  channel text not null default 'email' check (channel in ('email', 'linkedin_draft')),
  daily_limit integer not null default 25 check (daily_limit >= 0 and daily_limit <= 500),
  require_approval boolean not null default true,
  allow_automated_send boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  scheduled_for timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_workspace_idx on public.campaigns (workspace_id, status);

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'drafted', 'approved', 'sent', 'replied', 'stopped', 'skipped'
  )),
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  category text not null default 'cold',
  tone text not null default 'professional',
  subject text not null,
  body text not null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'resend')),
  email_address text not null,
  display_name text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  public_config jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, email_address)
);

create table public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  stop_on_reply boolean not null default true,
  stop_on_unsubscribe boolean not null default true,
  stop_on_not_interested boolean not null default true,
  max_emails integer not null default 4 check (max_emails > 0 and max_emails <= 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sequence_id uuid not null references public.email_sequences (id) on delete cascade,
  position integer not null check (position >= 1),
  delay_days integer not null default 0 check (delay_days >= 0 and delay_days <= 90),
  template_id uuid references public.email_templates (id) on delete set null,
  subject text not null default '',
  body text not null default '',
  condition jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, position)
);

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sequence_id uuid not null references public.email_sequences (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'stopped', 'waiting')),
  stop_reason text,
  current_step integer not null default 0,
  next_run_at timestamptz,
  waiting_draft_id uuid,
  last_sent_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, lead_id)
);

create index sequence_enrollments_due_idx
  on public.sequence_enrollments (status, next_run_at);

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  template_id uuid references public.email_templates (id) on delete set null,
  sequence_enrollment_id uuid references public.sequence_enrollments (id) on delete set null,
  sequence_step_id uuid references public.sequence_steps (id) on delete set null,
  subject text not null,
  body text not null,
  tone text not null default 'professional',
  purpose text not null default 'cold',
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded', 'scheduled', 'sent')),
  generator text not null default 'template' check (generator in ('template', 'ai')),
  personalization jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sequence_enrollments
  add constraint sequence_enrollments_waiting_draft_fkey
  foreign key (waiting_draft_id) references public.email_drafts (id) on delete set null;

create unique index email_drafts_step_once
  on public.email_drafts (workspace_id, lead_id, sequence_step_id)
  where sequence_step_id is not null and status <> 'discarded';

create index email_drafts_workspace_idx on public.email_drafts (workspace_id, status, created_at desc);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid references public.email_accounts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  draft_id uuid references public.email_drafts (id) on delete set null,
  sequence_step_id uuid references public.sequence_steps (id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  provider text,
  provider_message_id text,
  thread_key text,
  from_email text,
  to_email text,
  subject text not null default '',
  body_text text not null default '',
  status text not null default 'queued' check (status in (
    'draft', 'queued', 'scheduled', 'sent', 'delivered', 'bounced', 'failed', 'received', 'discarded'
  )),
  reply_category text check (reply_category is null or reply_category in (
    'interested', 'not_interested', 'needs_info', 'meeting_request', 'pricing',
    'follow_up_later', 'out_of_office', 'unsubscribe', 'uncategorized'
  )),
  reply_classifier text check (reply_classifier is null or reply_classifier in ('rules', 'ai', 'manual')),
  sent_at timestamptz,
  unsubscribe_token text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index email_messages_campaign_once
  on public.email_messages (workspace_id, lead_id, campaign_id)
  where campaign_id is not null
    and lead_id is not null
    and sequence_step_id is null
    and status in ('queued', 'scheduled', 'sent', 'delivered');

create unique index email_messages_step_once
  on public.email_messages (workspace_id, lead_id, sequence_step_id)
  where sequence_step_id is not null
    and lead_id is not null
    and status in ('queued', 'scheduled', 'sent', 'delivered');

create index email_messages_workspace_idx on public.email_messages (workspace_id, created_at desc);
create index email_messages_thread_idx on public.email_messages (workspace_id, thread_key);
create index email_messages_provider_idx on public.email_messages (provider_message_id);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message_id uuid not null references public.email_messages (id) on delete cascade,
  event_type text not null check (event_type in (
    'delivered', 'bounced', 'complained', 'replied', 'unsubscribed', 'deferred', 'failed'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_events_message_idx on public.email_events (message_id, occurred_at desc);

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------------------
-- Marketing, proposals, deals, tasks
-- ---------------------------------------------------------------------------

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  service_id uuid references public.service_catalog (id) on delete set null,
  name text not null,
  objective text not null default '',
  audience text not null default '',
  country text,
  industry text,
  platform text,
  brand_voice text,
  language text not null default 'en',
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_content (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  marketing_campaign_id uuid references public.marketing_campaigns (id) on delete set null,
  content_type text not null check (content_type in (
    'linkedin_post', 'instagram', 'facebook', 'blog', 'seo_page', 'announcement',
    'launch', 'newsletter', 'ad_copy', 'slogan', 'idea', 'case_study'
  )),
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  generator text not null default 'template' check (generator in ('template', 'ai')),
  published_at timestamptz,
  external_publish boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_content_workspace_idx on public.marketing_content (workspace_id, status, created_at desc);

create table public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_id uuid references public.marketing_content (id) on delete set null,
  title text not null,
  channel text not null default 'linkedin',
  scheduled_for date not null,
  status text not null default 'planned' check (status in ('planned', 'draft', 'approved', 'published')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_calendar_date_idx on public.content_calendar (workspace_id, scheduled_for);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  opportunity_id uuid references public.lead_opportunities (id) on delete set null,
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'accepted', 'declined')),
  structure jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proposals_workspace_idx on public.proposals (workspace_id, status);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  name text not null,
  value numeric(14, 2) not null default 0 check (value >= 0),
  currency text not null default 'INR',
  probability integer not null default 10 check (probability >= 0 and probability <= 100),
  stage text not null default 'qualified',
  expected_close date,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_workspace_idx on public.deals (workspace_id, stage);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  title text not null,
  notes text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_workspace_idx on public.tasks (workspace_id, status, due_at);

-- ---------------------------------------------------------------------------
-- Automation, AI, integrations, notifications, audit
-- ---------------------------------------------------------------------------

create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger text not null default 'lead.discovered',
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.automation_workflows (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'
  )),
  current_step integer not null default 0,
  idempotency_key text not null unique,
  logs jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index automation_executions_status_idx on public.automation_executions (workspace_id, status, created_at desc);

create table public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  provider text not null,
  model text not null,
  feature text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_usage_logs_workspace_idx on public.ai_usage_logs (workspace_id, created_at desc);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  status text not null default 'not_configured' check (status in ('not_configured', 'connected', 'error', 'disabled')),
  enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  last_error text,
  last_tested_at timestamptz,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- No policies are granted to authenticated users. Only the service role can read secrets.
create table public.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);

create table public.api_rate_limits (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Updated-at and workspace immutability
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'workspaces', 'workspace_members', 'company_profiles', 'company_settings',
    'products', 'service_catalog', 'product_assets', 'companies', 'contacts', 'leads',
    'lead_research', 'lead_opportunities', 'lead_scores', 'lead_activities', 'campaigns',
    'campaign_leads', 'email_templates', 'email_accounts', 'email_sequences', 'sequence_steps',
    'sequence_enrollments', 'email_drafts', 'email_messages', 'email_events', 'suppression_list',
    'marketing_campaigns', 'marketing_content', 'content_calendar', 'proposals', 'deals', 'tasks',
    'automation_workflows', 'automation_executions', 'ai_usage_logs', 'integrations',
    'integration_secrets', 'notifications', 'audit_logs', 'api_rate_limits'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'company_profiles', 'company_settings', 'products', 'service_catalog', 'product_assets',
    'companies', 'contacts', 'leads', 'lead_research', 'lead_opportunities', 'lead_scores',
    'lead_activities', 'campaigns', 'campaign_leads', 'email_templates', 'email_accounts',
    'email_sequences', 'sequence_steps', 'sequence_enrollments', 'email_drafts', 'email_messages',
    'email_events', 'suppression_list', 'marketing_campaigns', 'marketing_content', 'content_calendar',
    'proposals', 'deals', 'tasks', 'automation_workflows', 'automation_executions', 'ai_usage_logs',
    'integrations', 'integration_secrets', 'notifications', 'audit_logs', 'api_rate_limits'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_lock_workspace', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_workspace_move()',
      t || '_lock_workspace', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limit and retention
-- ---------------------------------------------------------------------------

create or replace function public.bump_rate_limit(
  p_ws uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_window_start timestamptz;
  current_count integer;
begin
  if uid is null or not public.is_workspace_member(p_ws) then
    return false;
  end if;
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits (workspace_id, user_id, bucket, window_start, count)
  values (p_ws, uid, p_bucket, v_window_start, 1)
  on conflict (workspace_id, user_id, bucket, window_start)
  do update set count = public.api_rate_limits.count + 1
  returning public.api_rate_limits.count into current_count;
  return current_count <= p_limit;
end;
$$;

create or replace function public.preview_retention(p_ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  days integer;
  cutoff timestamptz;
begin
  if not public.has_workspace_role(p_ws, array['owner', 'admin']) then
    raise exception 'Forbidden';
  end if;
  select data_retention_days into days from public.company_settings where workspace_id = p_ws;
  cutoff := now() - make_interval(days => coalesce(days, 730));
  return jsonb_build_object(
    'cutoff', cutoff,
    'activities', (select count(*) from public.lead_activities where workspace_id = p_ws and created_at < cutoff),
    'email_events', (select count(*) from public.email_events where workspace_id = p_ws and created_at < cutoff),
    'ai_usage', (select count(*) from public.ai_usage_logs where workspace_id = p_ws and created_at < cutoff),
    'read_notifications', (select count(*) from public.notifications where workspace_id = p_ws and read_at is not null and created_at < cutoff),
    'finished_executions', (select count(*) from public.automation_executions where workspace_id = p_ws and status in ('succeeded', 'cancelled', 'failed') and created_at < cutoff)
  );
end;
$$;

create or replace function public.purge_expired_workspace_data(p_ws uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer;
  cutoff timestamptz;
  removed jsonb;
begin
  if not public.has_workspace_role(p_ws, array['owner']) then
    raise exception 'Only the workspace owner can purge data';
  end if;
  select data_retention_days into days from public.company_settings where workspace_id = p_ws;
  cutoff := now() - make_interval(days => coalesce(days, 730));
  -- Suppression, audit logs, sent messages, leads, and companies are kept.
  with a as (
    delete from public.lead_activities where workspace_id = p_ws and created_at < cutoff returning 1
  ), e as (
    delete from public.email_events where workspace_id = p_ws and created_at < cutoff returning 1
  ), u as (
    delete from public.ai_usage_logs where workspace_id = p_ws and created_at < cutoff returning 1
  ), n as (
    delete from public.notifications where workspace_id = p_ws and read_at is not null and created_at < cutoff returning 1
  ), x as (
    delete from public.automation_executions
    where workspace_id = p_ws and status in ('succeeded', 'cancelled', 'failed') and created_at < cutoff
    returning 1
  )
  select jsonb_build_object(
    'activities', (select count(*) from a),
    'email_events', (select count(*) from e),
    'ai_usage', (select count(*) from u),
    'read_notifications', (select count(*) from n),
    'finished_executions', (select count(*) from x)
  ) into removed;
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, metadata)
  values (p_ws, auth.uid(), 'retention.purged', 'workspace', removed);
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_workspace(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']))
  with check (public.has_workspace_role(id, array['owner', 'admin']));

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']) and user_id <> auth.uid());

do $$
declare
  t text;
  standard_tables text[] := array[
    'company_profiles', 'company_settings', 'products', 'product_assets', 'service_catalog',
    'companies', 'contacts', 'leads', 'lead_research', 'lead_opportunities', 'campaigns',
    'campaign_leads', 'email_templates', 'email_drafts', 'email_accounts', 'email_messages',
    'email_sequences', 'sequence_steps', 'sequence_enrollments', 'suppression_list',
    'marketing_campaigns', 'marketing_content', 'content_calendar', 'proposals', 'deals',
    'tasks', 'automation_workflows', 'automation_executions', 'integrations'
  ];
begin
  foreach t in array standard_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''member'']))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''member''])) with check (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''member'']))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']))',
      t || '_delete', t
    );
  end loop;
end $$;

do $$
declare
  t text;
  append_tables text[] := array['lead_scores', 'lead_activities'];
begin
  foreach t in array append_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''member'']))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']))',
      t || '_delete', t
    );
  end loop;
end $$;

alter table public.email_events enable row level security;
create policy email_events_select on public.email_events
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy email_events_insert on public.email_events
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

alter table public.ai_usage_logs enable row level security;
create policy ai_usage_select on public.ai_usage_logs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy ai_usage_insert on public.ai_usage_logs
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.integration_secrets enable row level security;
alter table public.api_rate_limits enable row level security;
revoke all on public.integration_secrets from anon, authenticated;
revoke all on public.api_rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.create_workspace(text, text) from public, anon;
revoke execute on function public.bump_rate_limit(uuid, text, integer, integer) from public, anon;
revoke execute on function public.preview_retention(uuid) from public, anon;
revoke execute on function public.purge_expired_workspace_data(uuid) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.bump_rate_limit(uuid, text, integer, integer) to authenticated;
grant execute on function public.preview_retention(uuid) to authenticated;
grant execute on function public.purge_expired_workspace_data(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;
grant execute on function public.shares_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auth hook, storage, realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) and not exists (
    select 1 from pg_trigger where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values
      ('product-assets', 'product-assets', false),
      ('company-logos', 'company-logos', false),
      ('documents', 'documents', false)
    on conflict (id) do nothing;

    if not exists (select 1 from pg_policies where policyname = 'growthpilot_storage_select') then
      create policy growthpilot_storage_select on storage.objects
        for select to authenticated
        using (
          bucket_id in ('product-assets', 'company-logos', 'documents')
          and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
        );
    end if;
    if not exists (select 1 from pg_policies where policyname = 'growthpilot_storage_insert') then
      create policy growthpilot_storage_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id in ('product-assets', 'company-logos', 'documents')
          and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'member'])
        );
    end if;
    if not exists (select 1 from pg_policies where policyname = 'growthpilot_storage_update') then
      create policy growthpilot_storage_update on storage.objects
        for update to authenticated
        using (
          bucket_id in ('product-assets', 'company-logos', 'documents')
          and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'member'])
        );
    end if;
    if not exists (select 1 from pg_policies where policyname = 'growthpilot_storage_delete') then
      create policy growthpilot_storage_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id in ('product-assets', 'company-logos', 'documents')
          and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin'])
        );
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.email_messages;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
