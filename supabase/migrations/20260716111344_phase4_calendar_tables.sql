/*
# Phase 4 — Calendar & Holiday Tables

## Purpose
Create calendar_events, holiday_calendars, and holiday_calendar_dates tables
for company calendar, branch holidays, and working-day overrides.

## New Tables (3)

### 1. calendar_events
Organization/branch/department-scoped calendar events.
- id (uuid PK)
- organization_id (uuid FK -> organizations)
- branch_id (uuid FK -> branches, nullable) — null = org-wide
- department_id (uuid FK -> departments, nullable) — null = all departments
- title (text)
- description (text, nullable)
- event_type (text CHECK) — PUBLIC_HOLIDAY, COMPANY_HOLIDAY, BRANCH_HOLIDAY,
  WORKING_DAY_OVERRIDE, WEEKLY_OFF, COMPANY_EVENT, MEETING, TRAINING,
  ANNOUNCEMENT, OTHER
- start_date (date)
- end_date (date)
- start_time (time, nullable)
- end_time (time, nullable)
- is_all_day (boolean, default true)
- is_working_day_override (boolean, default false) — marks a weekly off as working
- is_weekly_off_override (boolean, default false) — marks a working day as off
- visibility_scope (text CHECK, default 'ORGANIZATION') — ORGANIZATION, BRANCH, DEPARTMENT, ROLE, EMPLOYEE
- created_by (uuid FK -> user_profiles)
- is_active (boolean, default true)
- created_at, updated_at (timestamptz)

### 2. holiday_calendars
Yearly holiday calendar per organization or branch.
- id (uuid PK)
- organization_id (uuid FK -> organizations)
- branch_id (uuid FK -> branches, nullable) — null = org-wide default
- name (text)
- year (integer)
- timezone (text, default 'Asia/Kolkata')
- is_default (boolean, default false)
- created_at, updated_at (timestamptz)
- UNIQUE (organization_id, branch_id, year) — one calendar per org/branch/year

### 3. holiday_calendar_dates
Individual holiday entries within a holiday calendar.
- id (uuid PK)
- holiday_calendar_id (uuid FK -> holiday_calendars)
- date (date)
- name (text) — holiday name
- holiday_type (text CHECK) — PUBLIC_HOLIDAY, COMPANY_HOLIDAY, BRANCH_HOLIDAY,
  RESTRICTED_HOLIDAY, OPTIONAL_HOLIDAY
- is_paid_holiday (boolean, default true)
- is_working_day_override (boolean, default false)
- created_by (uuid FK -> user_profiles)
- created_at (timestamptz)
- UNIQUE (holiday_calendar_id, date)

## Security
- RLS enabled on all tables
- No payroll/salary columns

## Notes
1. calendar_events supports working-day overrides (e.g. working Sunday)
2. holiday_calendars are year-scoped and can be org-wide or branch-specific
3. holiday_calendar_dates have a unique constraint per calendar+date
4. is_working_day_override on events/dates marks a normally-off day as working
5. is_weekly_off_override marks a normally-working day as off
*/

-- ============ calendar_events ============
CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  event_type text NOT NULL CHECK (event_type IN (
    'PUBLIC_HOLIDAY', 'COMPANY_HOLIDAY', 'BRANCH_HOLIDAY',
    'WORKING_DAY_OVERRIDE', 'WEEKLY_OFF', 'COMPANY_EVENT',
    'MEETING', 'TRAINING', 'ANNOUNCEMENT', 'OTHER'
  )),
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time,
  end_time time,
  is_all_day boolean NOT NULL DEFAULT true,
  is_working_day_override boolean NOT NULL DEFAULT false,
  is_weekly_off_override boolean NOT NULL DEFAULT false,
  visibility_scope text NOT NULL DEFAULT 'ORGANIZATION' CHECK (visibility_scope IN (
    'ORGANIZATION', 'BRANCH', 'DEPARTMENT', 'ROLE', 'EMPLOYEE'
  )),
  created_by uuid REFERENCES user_profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- ============ holiday_calendars ============
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  year integer NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, branch_id, year)
);

ALTER TABLE holiday_calendars ENABLE ROW LEVEL SECURITY;

-- ============ holiday_calendar_dates ============
CREATE TABLE IF NOT EXISTS holiday_calendar_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_calendar_id uuid NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  holiday_type text NOT NULL CHECK (holiday_type IN (
    'PUBLIC_HOLIDAY', 'COMPANY_HOLIDAY', 'BRANCH_HOLIDAY',
    'RESTRICTED_HOLIDAY', 'OPTIONAL_HOLIDAY'
  )),
  is_paid_holiday boolean NOT NULL DEFAULT true,
  is_working_day_override boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holiday_calendar_id, date)
);

ALTER TABLE holiday_calendar_dates ENABLE ROW LEVEL SECURITY;

-- ============ Indexes ============
CREATE INDEX IF NOT EXISTS idx_calendar_events_org ON calendar_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_branch ON calendar_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_holiday_calendars_org ON holiday_calendars(organization_id);
CREATE INDEX IF NOT EXISTS idx_holiday_calendars_year ON holiday_calendars(year);
CREATE INDEX IF NOT EXISTS idx_holiday_calendar_dates_calendar ON holiday_calendar_dates(holiday_calendar_id);
CREATE INDEX IF NOT EXISTS idx_holiday_calendar_dates_date ON holiday_calendar_dates(date);

-- ============ updated_at triggers ============
DROP TRIGGER IF EXISTS calendar_events_updated_at ON calendar_events;
CREATE TRIGGER calendar_events_updated_at BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS holiday_calendars_updated_at ON holiday_calendars;
CREATE TRIGGER holiday_calendars_updated_at BEFORE UPDATE ON holiday_calendars
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
