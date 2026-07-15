import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/dashboard.css'

export function Dashboard() {
  const { profile, permissions } = useAuth()

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
          <div className="dashboard-card-num mono">Phase 1</div>
          <div className="dashboard-card-lbl">Current Phase</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">{permissions.length}</div>
          <div className="dashboard-card-lbl">Active Permissions</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">RBAC</div>
          <div className="dashboard-card-lbl">Authorization</div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-num mono">Active</div>
          <div className="dashboard-card-lbl">Account Status</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Your Access</h3>
        <div className="dashboard-card dashboard-status-card">
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Organization</span>
            <span className="dashboard-status-value">{profile.organization_id ? 'Assigned' : 'Not assigned'}</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Role</span>
            <span className="dashboard-status-value">{roleLabel}</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Permissions</span>
            <span className="dashboard-status-value">{permissions.length} permission(s) granted</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Account Status</span>
            <span className="dashboard-status-value">{profile.status}</span>
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
            Phase 2 will add full employee lifecycle: detailed profiles, onboarding workflows,
            private document management, transfers, deactivation, and enhanced audit trails.
          </p>
        </div>
      </div>
    </div>
  )
}
