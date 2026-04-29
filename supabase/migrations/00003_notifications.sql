-- Notifications table for inbox
create type notification_type as enum (
  'issue_assigned',
  'issue_status_changed',
  'meeting_starting',
  'meeting_completed',
  'brief_ready',
  'share_received'
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  read boolean not null default false,
  link text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_notifications_user_unread on notifications(user_id, read, created_at desc);
create index idx_notifications_user_created on notifications(user_id, created_at desc);

alter table notifications enable row level security;

create policy "Users can view own notifications"
  on notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Service role can insert notifications"
  on notifications for insert
  with check (true);

-- Function to create a notification (callable from triggers or app code)
create or replace function create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_metadata jsonb default '{}'
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into notifications (user_id, type, title, body, link, metadata)
  values (p_user_id, p_type, p_title, p_body, p_link, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;

-- Trigger: notify owner when issue status changes
create or replace function notify_issue_status_change() returns trigger as $$
begin
  if OLD.status is distinct from NEW.status and NEW.owner_user_id is not null then
    perform create_notification(
      NEW.owner_user_id,
      'issue_status_changed',
      NEW.title || ' changed to ' || replace(NEW.status::text, '_', ' '),
      null,
      '/issues/' || NEW.id,
      jsonb_build_object('issue_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
    );
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger trg_issue_status_notification
  after update of status on issues
  for each row
  execute function notify_issue_status_change();

-- Trigger: notify when issue is assigned to a user
create or replace function notify_issue_assigned() returns trigger as $$
begin
  if NEW.owner_user_id is not null
     and (OLD.owner_user_id is null or OLD.owner_user_id is distinct from NEW.owner_user_id) then
    perform create_notification(
      NEW.owner_user_id,
      'issue_assigned',
      'You were assigned: ' || NEW.title,
      null,
      '/issues/' || NEW.id,
      jsonb_build_object('issue_id', NEW.id, 'series_id', NEW.series_id)
    );
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger trg_issue_assigned_notification
  after update of owner_user_id on issues
  for each row
  execute function notify_issue_assigned();
