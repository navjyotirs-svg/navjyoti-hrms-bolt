import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS, EMPLOYMENT_STATUS_LABELS, SENSITIVE_FIELDS } from '@/types/roles'
import '@/styles/shared.css'

type TabId = 'overview' | 'personal' | 'employment' | 'documents' | 'onboarding' | 'transfers' | 'status' | 'audit'
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'personal', label: 'Personal Details' },
  { id: 'employment', label: 'Employment Details' }, { id: 'documents', label: 'Documents' },
  { id: 'onboarding', label: 'Onboarding' }, { id: 'transfers', label: 'Transfer History' },
  { id: 'status', label: 'Status History' }, { id: 'audit', label: 'Audit History' },
]

interface Employee {
  id: string; employee_code: string; full_name: string; preferred_name: string | null
  designation: string | null; work_email: string; work_mode: string; employment_status: string
  employment_type: string | null; joining_date: string; probation_end_date: string | null
  confirmation_date: string | null; branch_id: string | null; department_id: string | null
  reporting_manager_id: string | null; user_id: string; date_of_birth: string | null
  gender: string | null; personal_email: string | null; mobile_number: string | null
  alternate_mobile_number: string | null; current_address: string | null; permanent_address: string | null
  emergency_contact_name: string | null; emergency_contact_relation: string | null; emergency_contact_phone: string | null
}
interface Doc { id: string; file_name: string; storage_path: string; status: string; document_type_id: string; rejection_reason: string | null; created_at: string; document_types?: { label: string } | null }
interface OnbItem { id: string; item_key: string; label: string; status: string; assigned_to: string | null; notes: string | null }
interface Transfer { id: string; effective_date: string; reason: string | null; status: string; created_at: string }
interface StatusHist { id: string; old_status: string | null; new_status: string; reason: string | null; effective_date: string; created_at: string }
interface AuditLog { id: string; actor_id: string | null; action: string; entity_type: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; created_at: string }

const f = (v: string | null | undefined) => (v ? String(v) : '—')
const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="info-row"><span className="info-label">{label}</span><span className="info-value">{value ?? '—'}</span></div>
)
function statusTag(s: string): React.ReactNode {
  const l = s.toLowerCase()
  const cls = ['verified', 'completed', 'approved', 'confirmed', 'active'].includes(l) ? 'tag-teal'
    : ['pending', 'in_progress', 'on_probation', 'notice_period'].includes(l) ? 'tag-amber'
    : ['rejected', 'terminated', 'suspended', 'resigned'].includes(l) ? 'tag-rose' : 'tag-gray'
  return <span className={`tag ${cls}`}>{s}</span>
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { permissions, profile } = useAuth()
  const [emp, setEmp] = useState<Employee | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [dept, setDept] = useState<string | null>(null)
  const [mgr, setMgr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [docs, setDocs] = useState<Doc[]>([])
  const [onb, setOnb] = useState<OnbItem[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [statusHist, setStatusHist] = useState<StatusHist[]>([])
  const [audit, setAudit] = useState<AuditLog[]>([])
  const [loaded, setLoaded] = useState<Set<TabId>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)

  const canSensitive = permissions.includes('employee.profile.view_sensitive')
  const canUpload = permissions.includes('employee.document.upload_self') || permissions.includes('employee.document.manage')
  const canManageDoc = permissions.includes('employee.document.manage')
  const canManageOnb = permissions.includes('employee.onboarding.manage')

  useEffect(() => {
    if (!id) return
    let c = false; setLoading(true); setError(null)
    async function load() {
      const { data, error: e } = await supabase.from('employees').select('*').eq('id', id!).maybeSingle()
      if (c) return
      if (e || !data) { setError(e?.message ?? 'Employee not found'); setLoading(false); return }
      const em = data as Employee; setEmp(em)
      const [pR, bR, dR, mR] = await Promise.all([
        supabase.from('user_profiles').select('role').eq('id', em.user_id).maybeSingle(),
        em.branch_id ? supabase.from('branches').select('name').eq('id', em.branch_id).maybeSingle() : Promise.resolve({ data: null }),
        em.department_id ? supabase.from('departments').select('name').eq('id', em.department_id).maybeSingle() : Promise.resolve({ data: null }),
        em.reporting_manager_id ? supabase.from('employees').select('full_name').eq('id', em.reporting_manager_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (c) return
      if (pR.data) setRole((pR.data as { role: string }).role)
      if (bR.data) setBranch((bR.data as { name: string }).name)
      if (dR.data) setDept((dR.data as { name: string }).name)
      if (mR.data) setMgr((mR.data as { full_name: string }).full_name)
      setLoading(false)
    }
    load(); return () => { c = true }
  }, [id])

  useEffect(() => {
    if (!id || loaded.has(tab)) return
    setLoaded((p) => new Set(p).add(tab))
    async function lt() {
      if (tab === 'documents') {
        const { data } = await supabase.from('employee_documents')
          .select('id, file_name, storage_path, status, document_type_id, rejection_reason, created_at, document_types(label)')
          .eq('employee_id', id!).order('created_at', { ascending: false })
        setDocs((data ?? []) as unknown as Doc[])
      } else if (tab === 'onboarding') {
        const { data: ck } = await supabase.from('onboarding_checklists').select('id').eq('employee_id', id!).maybeSingle()
        if (ck) {
          const { data: items } = await supabase.from('onboarding_checklist_items')
            .select('id, item_key, label, status, assigned_to, notes').eq('checklist_id', (ck as { id: string }).id).order('label')
          setOnb((items ?? []) as OnbItem[])
        }
      } else if (tab === 'transfers') {
        const { data } = await supabase.from('employee_transfers')
          .select('id, effective_date, reason, status, created_at').eq('employee_id', id!).order('created_at', { ascending: false })
        setTransfers((data ?? []) as Transfer[])
      } else if (tab === 'status') {
        const { data } = await supabase.from('employee_status_history')
          .select('id, old_status, new_status, reason, effective_date, created_at').eq('employee_id', id!).order('created_at', { ascending: false })
        setStatusHist((data ?? []) as StatusHist[])
      } else if (tab === 'audit') {
        const { data } = await supabase.from('audit_logs')
          .select('id, actor_id, action, entity_type, old_values, new_values, created_at').eq('entity_id', id!)
          .order('created_at', { ascending: false }).limit(100)
        setAudit((data ?? []) as AuditLog[])
      }
    }
    lt()
  }, [tab, id, loaded])

  async function upload(file: File, docTypeId: string) {
    if (!emp || !docTypeId) return
    setMsg(null)
    const ext = file.name.split('.').pop() ?? 'bin'
    const path = `${emp.user_id}/${crypto.randomUUID()}.${ext}`
    const { error: ue } = await supabase.storage.from('employee-documents').upload(path, file)
    if (ue) { setMsg(`Upload failed: ${ue.message}`); return }
    const { error: ie } = await supabase.from('employee_documents').insert({
      employee_id: emp.id, document_type_id: docTypeId, file_name: file.name, storage_path: path,
      mime_type: file.type, file_size_bytes: file.size, version: 1, status: 'pending', uploaded_by: profile?.id,
    })
    if (ie) { setMsg(`Insert failed: ${ie.message}`); return }
    setMsg('Document uploaded.'); setLoaded((p) => { const n = new Set(p); n.delete('documents'); return n })
  }

  async function download(path: string) {
    const { data, error: de } = await supabase.storage.from('employee-documents').createSignedUrl(path, 60)
    if (de || !data?.signedUrl) { setMsg('Download failed.'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function docAction(d: Doc, ns: 'verified' | 'rejected') {
    if (!profile) return
    const { error } = await supabase.from('employee_documents').update({ status: ns, verified_by: profile.id }).eq('id', d.id)
    if (error) { setMsg(`Update failed: ${error.message}`); return }
    await supabase.from('document_verification_history').insert({
      document_id: d.id, action: ns, actor_id: profile.id, old_status: d.status, new_status: ns,
    })
    setMsg(`Document ${ns}.`); setLoaded((p) => { const n = new Set(p); n.delete('documents'); return n })
  }

  async function onbStatus(item: OnbItem, status: string) {
    const { error } = await supabase.from('onboarding_checklist_items').update({ status }).eq('id', item.id)
    if (error) { setMsg(`Update failed: ${error.message}`); return }
    setMsg('Onboarding item updated.'); setOnb((p) => p.map((i) => (i.id === item.id ? { ...i, status } : i)))
  }

  if (loading) return <div className="loading-state">Loading…</div>
  if (error || !emp) return (
    <div className="page">
      <div className="empty-state"><div className="empty-state-text">{error ?? 'Employee not found'}</div></div>
      <Link to="/employees" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Back to Employees</Link>
    </div>
  )

  const blocked = (field: string) => SENSITIVE_FIELDS.includes(field as typeof SENSITIVE_FIELDS[number]) && !canSensitive
  const empStatus = EMPLOYMENT_STATUS_LABELS[emp.employment_status as keyof typeof EMPLOYMENT_STATUS_LABELS] ?? emp.employment_status

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">{emp.full_name}</h2>
        <Link to="/employees" className="btn btn-sm btn-secondary">Back</Link>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            borderRadius: '6px 6px 0 0', background: tab === t.id ? 'var(--teal)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--slate)',
          }}>{t.label}</button>
        ))}
      </div>

      {msg && <div className="form-success">{msg}</div>}

      {tab === 'overview' && (
        <div className="card"><div className="info-list">
          <Row label="Employee Code" value={<span className="mono">{emp.employee_code}</span>} />
          <Row label="Full Name" value={emp.full_name} />
          <Row label="Preferred Name" value={emp.preferred_name} />
          <Row label="Designation" value={emp.designation} />
          <Row label="Work Email" value={emp.work_email} />
          <Row label="Work Mode" value={emp.work_mode} />
          <Row label="Employment Status" value={statusTag(empStatus)} />
          <Row label="Joining Date" value={<span className="mono">{emp.joining_date}</span>} />
          <Row label="Branch" value={branch} />
          <Row label="Department" value={dept} />
          <Row label="Reporting Manager" value={mgr} />
          <Row label="Employment Type" value={emp.employment_type} />
          <Row label="Probation End Date" value={emp.probation_end_date && <span className="mono">{emp.probation_end_date}</span>} />
          <Row label="Confirmation Date" value={emp.confirmation_date && <span className="mono">{emp.confirmation_date}</span>} />
          <Row label="Role" value={role ? <span className="tag tag-ink">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}</span> : '—'} />
        </div></div>
      )}

      {tab === 'personal' && (
        <div className="card"><div className="info-list">
          <Row label="Date of Birth" value={blocked('date_of_birth') ? 'Restricted' : emp.date_of_birth && <span className="mono">{emp.date_of_birth}</span>} />
          <Row label="Gender" value={blocked('gender') ? 'Restricted' : f(emp.gender)} />
          <Row label="Personal Email" value={blocked('personal_email') ? 'Restricted' : f(emp.personal_email)} />
          <Row label="Mobile Number" value={blocked('mobile_number') ? 'Restricted' : f(emp.mobile_number)} />
          <Row label="Alternate Mobile" value={blocked('alternate_mobile_number') ? 'Restricted' : f(emp.alternate_mobile_number)} />
          <Row label="Current Address" value={blocked('current_address') ? 'Restricted' : f(emp.current_address)} />
          <Row label="Permanent Address" value={blocked('permanent_address') ? 'Restricted' : f(emp.permanent_address)} />
          <Row label="Emergency Contact Name" value={blocked('emergency_contact_name') ? 'Restricted' : f(emp.emergency_contact_name)} />
          <Row label="Emergency Contact Relation" value={blocked('emergency_contact_relation') ? 'Restricted' : f(emp.emergency_contact_relation)} />
          <Row label="Emergency Contact Phone" value={blocked('emergency_contact_phone') ? 'Restricted' : f(emp.emergency_contact_phone)} />
        </div></div>
      )}

      {tab === 'employment' && (
        <div className="card"><div className="info-list">
          <Row label="Employee Code" value={<span className="mono">{emp.employee_code}</span>} />
          <Row label="Designation" value={emp.designation} />
          <Row label="Employment Type" value={emp.employment_type} />
          <Row label="Work Mode" value={emp.work_mode} />
          <Row label="Employment Status" value={statusTag(empStatus)} />
          <Row label="Joining Date" value={<span className="mono">{emp.joining_date}</span>} />
          <Row label="Probation End Date" value={emp.probation_end_date && <span className="mono">{emp.probation_end_date}</span>} />
          <Row label="Confirmation Date" value={emp.confirmation_date && <span className="mono">{emp.confirmation_date}</span>} />
          <Row label="Branch" value={branch} />
          <Row label="Department" value={dept} />
          <Row label="Reporting Manager" value={mgr} />
        </div></div>
      )}

      {tab === 'documents' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Documents {canUpload && <UploadButton onUpload={upload} />}
          </div>
          {docs.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No documents uploaded.</div></div>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Type</th><th>File</th><th>Status</th><th>Uploaded</th><th>Actions</th></tr></thead>
              <tbody>{docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.document_types?.label ?? '—'}</td>
                  <td>{d.file_name}</td>
                  <td>{statusTag(d.status)}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                  <td><div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => download(d.storage_path)}>Download</button>
                    {canManageDoc && d.status !== 'verified' && <button className="btn btn-sm" onClick={() => docAction(d, 'verified')}>Verify</button>}
                    {canManageDoc && d.status !== 'rejected' && <button className="btn btn-sm btn-danger" onClick={() => docAction(d, 'rejected')}>Reject</button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'onboarding' && (
        <div className="card">
          <div className="card-header">Onboarding Checklist</div>
          {onb.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No onboarding checklist found.</div></div>
          ) : (
            <div className="info-list">{onb.map((item) => (
              <div className="info-row" key={item.id} style={{ alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                  {item.assigned_to && <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Assigned to: {item.assigned_to}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statusTag(item.status)}
                  {canManageOnb && <select value={item.status} onChange={(e) => onbStatus(item, e.target.value)} style={{ fontSize: '12px', padding: '4px 8px' }}><option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select>}
                </div>
              </div>
            ))}</div>
          )}
        </div>
      )}

      {tab === 'transfers' && (
        <div className="card">
          <div className="card-header">Transfer History</div>
          {transfers.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No transfer records.</div></div>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Effective Date</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>{transfers.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.effective_date}</td>
                  <td>{t.reason ?? '—'}</td>
                  <td>{statusTag(t.status)}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'status' && (
        <div className="card">
          <div className="card-header">Status History</div>
          {statusHist.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No status changes recorded.</div></div>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Effective Date</th><th>From</th><th>To</th><th>Reason</th><th>Recorded</th></tr></thead>
              <tbody>{statusHist.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.effective_date}</td>
                  <td>{s.old_status ? statusTag(s.old_status) : '—'}</td>
                  <td>{statusTag(s.new_status)}</td>
                  <td>{s.reason ?? '—'}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{new Date(s.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-header">Audit History</div>
          {audit.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No audit entries for this employee.</div></div>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Timestamp</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>{audit.map((l) => (
                <tr key={l.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                  <td><span className="tag tag-ink">{l.action}</span></td>
                  <td className="mono" style={{ fontSize: '11px' }}>{l.entity_type}</td>
                  <td style={{ maxWidth: '300px', fontSize: '12px', color: 'var(--slate)' }}>{l.new_values ? JSON.stringify(l.new_values).slice(0, 120) : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  )
}

function UploadButton({ onUpload }: { onUpload: (file: File, docTypeId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [docTypeId, setDocTypeId] = useState('')
  const [docTypes, setDocTypes] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    if (open && docTypes.length === 0) {
      supabase.from('document_types').select('id, label').order('label').then(({ data }) => {
        if (data) setDocTypes(data as { id: string; label: string }[])
      })
    }
  }, [open, docTypes.length])
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>+ Upload</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Upload Document<button className="modal-close" onClick={() => setOpen(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field" style={{ marginBottom: 12 }}>
                <label>Document Type</label>
                <select value={docTypeId} onChange={(e) => setDocTypeId(e.target.value)} style={{ padding: '8px' }}><option value="">Select type…</option>{docTypes.map((dt) => <option key={dt.id} value={dt.id}>{dt.label}</option>)}</select>
              </div>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const fl = e.target.files?.[0]; if (fl && docTypeId) { onUpload(fl, docTypeId); setOpen(false) } }} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
