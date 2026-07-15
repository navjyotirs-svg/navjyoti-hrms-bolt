import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/dashboard.css'

export function Dashboard() {
  const { profile } = useAuth()

  if (!profile) return null

  const roleLabel = profile.role ? ROLE_LABELS[profile.role] : 'Not assigned'

  return (
    <div className="dashboard">
      <div className="dashboard-welcome">
        <h2 className="dashboard-greeting">
          Welcome, {profile.full_name ?? profile.email}
        </h2>
        <p className="dashboard-role">
          Role: <span className="dashboard-role-badge">{roleLabel}</span>
        </p>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">Phase 0</div>
          <div className="dashboard-card-lbl">Current Phase</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">7</div>
          <div className="dashboard-card-lbl">System Roles</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">Auth</div>
          <div className="dashboard-card-lbl">Foundation Status</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">Ready</div>
          <div className="dashboard-card-lbl">Phase 1 Readiness</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">System Status</h3>
        <div className="dashboard-card dashboard-status-card">
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Database Connection</span>
            <span className="dashboard-status-value">Supabase Connected</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Authentication</span>
            <span className="dashboard-status-value">Email / Password (Bolt Auth)</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">User Profile</span>
            <span className="dashboard-status-value">{profile.email}</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Role Assignment</span>
            <span className="dashboard-status-value">{roleLabel}</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Payroll Module</span>
            <span className="dashboard-status-value dashboard-status-excluded">Excluded by scope</span>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">What's Next</h3>
        <div className="dashboard-card">
          <p className="dashboard-next-text">
            Phase 1 will establish organizations, branches, departments, reporting hierarchy,
            and full role-based access control (RBAC) with database-enforced RLS policies.
          </p>
        </div>
      </div>
    </div>
  )
}
