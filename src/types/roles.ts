export type Role =
  | 'director'
  | 'hr_admin'
  | 'manager'
  | 'team_leader'
  | 'employee'
  | 'intern'
  | 'system_admin'

export type Permission =
  | 'organization.read'
  | 'organization.manage'
  | 'branch.read'
  | 'branch.manage'
  | 'department.read'
  | 'department.manage'
  | 'employee.read_self'
  | 'employee.read_team'
  | 'employee.read_all'
  | 'employee.create'
  | 'employee.update'
  | 'employee.deactivate'
  | 'role.assign'
  | 'reporting_line.manage'
  | 'audit.read'
  | 'employee.profile.read_self'
  | 'employee.profile.read_team'
  | 'employee.profile.read_all'
  | 'employee.profile.update_self'
  | 'employee.profile.update_all'
  | 'employee.document.upload_self'
  | 'employee.document.read_self'
  | 'employee.document.manage'
  | 'employee.onboarding.manage'
  | 'employee.transfer.manage'
  | 'employee.status.manage'
  | 'employee.offboarding.manage'
  | 'employee.profile.view_sensitive'
  | 'attendance.check_in_self'
  | 'attendance.check_out_self'
  | 'attendance.read_self'
  | 'attendance.read_team'
  | 'attendance.read_all'
  | 'attendance.correct_request_self'
  | 'attendance.correct_manage'
  | 'attendance.evidence_upload_self'
  | 'attendance.evidence_read_self'
  | 'attendance.evidence_read_all'
  | 'attendance.report_read'
  | 'leave.request_self'
  | 'leave.read_self'
  | 'leave.read_team'
  | 'leave.read_all'
  | 'leave.review_manager'
  | 'leave.approve_hr'
  | 'leave.override_director'
  | 'leave.cancel_self'
  | 'leave.cancel_manage'
  | 'leave.balance_read_self'
  | 'leave.balance_read_all'
  | 'leave.balance_adjust'
  | 'leave.policy_manage'
  | 'leave.document_upload_self'
  | 'leave.document_read_manage'
  | 'calendar.read'
  | 'calendar.event_create'
  | 'calendar.event_update'
  | 'calendar.event_delete'
  | 'calendar.holiday_manage'
  | 'calendar.branch_manage'

export type AttendanceStatus = 'PENDING_CHECKOUT' | 'FULL_DAY' | 'HALF_DAY'

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PENDING_CHECKOUT: 'Pending Checkout',
  FULL_DAY: 'Full Day',
  HALF_DAY: 'Half Day',
}

export type LeaveStatus =
  | 'DRAFT'
  | 'PENDING_MANAGER'
  | 'PENDING_HR'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'WITHDRAWN'

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  DRAFT: 'Draft',
  PENDING_MANAGER: 'Pending Manager',
  PENDING_HR: 'Pending HR',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  WITHDRAWN: 'Withdrawn',
}

export type LeaveTransactionType =
  | 'OPENING_BALANCE'
  | 'MONTHLY_ACCRUAL'
  | 'LEAVE_RESERVED'
  | 'LEAVE_USED'
  | 'LEAVE_CANCELLED_RESTORED'
  | 'MANUAL_ADJUSTMENT'
  | 'CARRY_FORWARD'
  | 'EXPIRY'
  | 'REVERSAL'

export const LEAVE_TRANSACTION_LABELS: Record<LeaveTransactionType, string> = {
  OPENING_BALANCE: 'Opening Balance',
  MONTHLY_ACCRUAL: 'Monthly Accrual',
  LEAVE_RESERVED: 'Leave Reserved',
  LEAVE_USED: 'Leave Used',
  LEAVE_CANCELLED_RESTORED: 'Restored (Cancellation)',
  MANUAL_ADJUSTMENT: 'Manual Adjustment',
  CARRY_FORWARD: 'Carry Forward',
  EXPIRY: 'Expired',
  REVERSAL: 'Reversal',
}

export type CalendarEventType =
  | 'PUBLIC_HOLIDAY'
  | 'COMPANY_HOLIDAY'
  | 'BRANCH_HOLIDAY'
  | 'WORKING_DAY_OVERRIDE'
  | 'WEEKLY_OFF'
  | 'COMPANY_EVENT'
  | 'MEETING'
  | 'TRAINING'
  | 'ANNOUNCEMENT'
  | 'OTHER'

export const CALENDAR_EVENT_LABELS: Record<CalendarEventType, string> = {
  PUBLIC_HOLIDAY: 'Public Holiday',
  COMPANY_HOLIDAY: 'Company Holiday',
  BRANCH_HOLIDAY: 'Branch Holiday',
  WORKING_DAY_OVERRIDE: 'Working Day Override',
  WEEKLY_OFF: 'Weekly Off',
  COMPANY_EVENT: 'Company Event',
  MEETING: 'Meeting',
  TRAINING: 'Training',
  ANNOUNCEMENT: 'Announcement',
  OTHER: 'Other',
}

export const LEAVE_APPROVED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const

export const LEAVE_APPROVED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']

export const LEAVE_MAX_FILE_BYTES = 10 * 1024 * 1024

export type CorrectionType =
  | 'missed_check_in'
  | 'missed_checkout'
  | 'technical_problem'
  | 'camera_problem'
  | 'location_problem'
  | 'official_field_duty'
  | 'other'

export const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
  missed_check_in: 'Missed Check-In',
  missed_checkout: 'Missed Checkout',
  technical_problem: 'Technical Problem',
  camera_problem: 'Camera Problem',
  location_problem: 'Location Problem',
  official_field_duty: 'Official Field Duty',
  other: 'Other',
}

export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

export const ATTENDANCE_APPROVED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const

export const ATTENDANCE_APPROVED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

export const ATTENDANCE_MAX_PHOTO_BYTES = 10 * 1024 * 1024

export type AccountStatus = 'active' | 'pending_activation' | 'disabled'

export type EmploymentStatus =
  | 'invited'
  | 'pending_activation'
  | 'active'
  | 'on_probation'
  | 'confirmed'
  | 'transferred'
  | 'suspended'
  | 'notice_period'
  | 'resigned'
  | 'terminated'
  | 'inactive'
  | 'offboarded'

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  invited: 'Invited',
  pending_activation: 'Pending Activation',
  active: 'Active',
  on_probation: 'On Probation',
  confirmed: 'Confirmed',
  transferred: 'Transferred',
  suspended: 'Suspended',
  notice_period: 'Notice Period',
  resigned: 'Resigned',
  terminated: 'Terminated',
  inactive: 'Inactive',
  offboarded: 'Offboarded',
}

export interface RoleDefinition {
  code: Role
  label: string
  description: string
}

export const ROLES: RoleDefinition[] = [
  { code: 'director', label: 'Director', description: 'Full system access and final approval authority' },
  { code: 'hr_admin', label: 'HR Administrator', description: 'Employee lifecycle, leave, and HR operations' },
  { code: 'manager', label: 'Manager', description: 'Department management, task assignment, and approvals' },
  { code: 'team_leader', label: 'Team Leader', description: 'Team coordination and task oversight' },
  { code: 'employee', label: 'Employee', description: 'Personal attendance, tasks, reports, and tickets' },
  { code: 'intern', label: 'Intern / Trainee', description: 'Learning track with guided task assignment' },
  { code: 'system_admin', label: 'System Administrator', description: 'Platform configuration and security' },
]

export const ROLE_LABELS: Record<Role, string> = ROLES.reduce(
  (acc, r) => ({ ...acc, [r.code]: r.label }),
  {} as Record<Role, string>
)

export const PERMISSION_LABELS: Record<Permission, string> = {
  'organization.read': 'View Organization',
  'organization.manage': 'Manage Organization',
  'branch.read': 'View Branches',
  'branch.manage': 'Manage Branches',
  'department.read': 'View Departments',
  'department.manage': 'Manage Departments',
  'employee.read_self': 'View Own Profile',
  'employee.read_team': 'View Team',
  'employee.read_all': 'View All Employees',
  'employee.create': 'Create Employee',
  'employee.update': 'Update Employee',
  'employee.deactivate': 'Deactivate Employee',
  'role.assign': 'Assign Roles',
  'reporting_line.manage': 'Manage Reporting Lines',
  'audit.read': 'View Audit Trail',
  'employee.profile.read_self': 'View Own Profile Details',
  'employee.profile.read_team': 'View Team Profiles',
  'employee.profile.read_all': 'View All Profiles',
  'employee.profile.update_self': 'Update Own Profile',
  'employee.profile.update_all': 'Update Employee Profiles',
  'employee.document.upload_self': 'Upload Own Documents',
  'employee.document.read_self': 'Read Own Documents',
  'employee.document.manage': 'Manage Documents',
  'employee.onboarding.manage': 'Manage Onboarding',
  'employee.transfer.manage': 'Manage Transfers',
  'employee.status.manage': 'Manage Employment Status',
  'employee.offboarding.manage': 'Manage Offboarding',
  'employee.profile.view_sensitive': 'View Sensitive Fields',
  'attendance.check_in_self': 'Check In Self',
  'attendance.check_out_self': 'Check Out Self',
  'attendance.read_self': 'Read Own Attendance',
  'attendance.read_team': 'Read Team Attendance',
  'attendance.read_all': 'Read All Attendance',
  'attendance.correct_request_self': 'Request Attendance Correction',
  'attendance.correct_manage': 'Manage Attendance Corrections',
  'attendance.evidence_upload_self': 'Upload Attendance Evidence',
  'attendance.evidence_read_self': 'Read Own Attendance Evidence',
  'attendance.evidence_read_all': 'Read All Attendance Evidence',
  'attendance.report_read': 'Read Attendance Reports',
  'leave.request_self': 'Request Own Leave',
  'leave.read_self': 'Read Own Leave',
  'leave.read_team': 'Read Team Leave',
  'leave.read_all': 'Read All Leave',
  'leave.review_manager': 'Review as Manager',
  'leave.approve_hr': 'Approve as HR',
  'leave.override_director': 'Director Override',
  'leave.cancel_self': 'Cancel Own Leave',
  'leave.cancel_manage': 'Manage Cancellations',
  'leave.balance_read_self': 'Read Own Balances',
  'leave.balance_read_all': 'Read All Balances',
  'leave.balance_adjust': 'Adjust Balances',
  'leave.policy_manage': 'Manage Leave Policy',
  'leave.document_upload_self': 'Upload Leave Documents',
  'leave.document_read_manage': 'Read Leave Documents',
  'calendar.read': 'View Calendar',
  'calendar.event_create': 'Create Calendar Events',
  'calendar.event_update': 'Update Calendar Events',
  'calendar.event_delete': 'Delete Calendar Events',
  'calendar.holiday_manage': 'Manage Holidays',
  'calendar.branch_manage': 'Manage Branch Calendars',
}

export type NavItem = {
  id: string
  label: string
  icon: string
  permissions: Permission[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    permissions: [],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1',
    permissions: ['organization.read'],
  },
  {
    id: 'branches',
    label: 'Branches',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-5m-9 0H3m2 0h5',
    permissions: ['branch.read'],
  },
  {
    id: 'departments',
    label: 'Departments',
    icon: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    permissions: ['department.read'],
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2a4 4 0 10-8 4 4 0 000 8z',
    permissions: ['employee.read_self', 'employee.read_team', 'employee.read_all', 'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.read_all'],
  },
  {
    id: 'hierarchy',
    label: 'Reporting Hierarchy',
    icon: 'M5 3v4M3 5h4M6 21v-4M4 19h4M13 3l4 4M17 3l-4 4M13 21l4-4M17 21l-4-4',
    permissions: ['employee.read_team', 'employee.read_all', 'reporting_line.manage', 'employee.profile.read_team', 'employee.profile.read_all'],
  },
  {
    id: 'roles',
    label: 'Roles & Permissions',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    permissions: ['role.assign', 'audit.read'],
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    permissions: ['audit.read'],
  },
  {
    id: 'attendance',
    label: 'My Attendance',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    permissions: ['attendance.read_self', 'attendance.check_in_self'],
  },
  {
    id: 'attendance-management',
    label: 'Attendance Management',
    icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    permissions: ['attendance.read_all', 'attendance.correct_manage', 'attendance.report_read'],
  },
  {
    id: 'attendance-corrections',
    label: 'Corrections',
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    permissions: ['attendance.correct_request_self', 'attendance.correct_manage'],
  },
  {
    id: 'my-leave',
    label: 'My Leave',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    permissions: ['leave.read_self', 'leave.request_self'],
  },
  {
    id: 'team-leave',
    label: 'Team Leave',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2a4 4 0 10-8 4 4 0 000 8z',
    permissions: ['leave.read_team', 'leave.review_manager'],
  },
  {
    id: 'leave-management',
    label: 'Leave Management',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    permissions: ['leave.read_all', 'leave.approve_hr', 'leave.balance_read_all', 'leave.policy_manage'],
  },
  {
    id: 'calendar',
    label: 'Company Calendar',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    permissions: ['calendar.read'],
  },
  {
    id: 'holidays',
    label: 'Holiday Management',
    icon: 'M5 3v4M3 5h4M6 21v-4M4 19h4M13 3l4 4M17 3l-4 4M13 21l4-4M17 21l-4-4',
    permissions: ['calendar.holiday_manage'],
  },
  {
    id: 'settings',
    label: 'Account Settings',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
    permissions: [],
  },
]

export function navItemsForPermissions(permissions: Permission[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      item.permissions.length === 0 ||
      item.permissions.some((p) => permissions.includes(p))
  )
}

export const SENSITIVE_FIELDS = [
  'date_of_birth',
  'personal_email',
  'mobile_number',
  'alternate_mobile_number',
  'current_address',
  'permanent_address',
  'emergency_contact_name',
  'emergency_contact_relation',
  'emergency_contact_phone',
  'gender',
] as const

export const SELF_SERVICE_FIELDS = [
  'preferred_name',
  'personal_email',
  'mobile_number',
  'alternate_mobile_number',
  'current_address',
  'permanent_address',
  'emergency_contact_name',
  'emergency_contact_relation',
  'emergency_contact_phone',
  'profile_photo_reference',
] as const

export const APPROVED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const

export const APPROVED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
