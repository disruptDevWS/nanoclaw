# RBAC Spec: Dashboard Role-Based Access Control

> **Audience**: Lovable AI — implement these changes in the ForgeGrowth dashboard app.

## Overview

The dashboard needs multi-user access with role-based visibility. Users log in via Supabase Auth and see only the audits they're authorized to view. The database migration (already applied) handles all access control via RLS policies and a `can_view_audit()` function.

### Role Matrix

| Role | Who | Dashboard Access | Can Manage |
|------|-----|-----------------|------------|
| `super_admin` | Matt (owner) | All audits | Yes — create, delete, share, manage users |
| `admin` | Agency partners | Assigned audits only | No |
| `user` | Clients | Assigned audits only | No |
| `temp` | Sales prospects | Assigned audits only (time-limited) | No |

**Key principle**: RLS handles data filtering. The UI just needs to hide/show buttons based on role.

---

## 1. Auth Context Changes

**File**: `src/contexts/AuthContext.tsx`

### Add role to context

After the session loads and `user` is available, query the user's role:

```typescript
// Add to AuthContext state
const [userRole, setUserRole] = useState<'super_admin' | 'admin' | 'user' | 'temp' | null>(null);

// After session is established, fetch role
useEffect(() => {
  if (!user) {
    setUserRole(null);
    return;
  }

  const fetchRole = async () => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .order('role')  // super_admin sorts first
      .limit(1);

    if (data && data.length > 0) {
      setUserRole(data[0].role as any);
    } else {
      setUserRole(null);  // no explicit role = regular owner
    }
  };

  fetchRole();
}, [user]);
```

### Add helper flags to context value

```typescript
// Derived permissions — add to context value
const canManage = userRole === 'super_admin' || (!userRole && !!user);
// super_admin can manage; null role = audit owner (pre-RBAC user), can manage own
// admin/user/temp = read-only guests

const isGuest = userRole === 'admin' || userRole === 'user' || userRole === 'temp';
// Guest = has explicit role but doesn't own audits. Used to hide create/delete/share UI.
```

### Export from context

Add `userRole`, `canManage`, and `isGuest` to the context value object so all components can consume them.

```typescript
// Context value
const value = {
  user,
  session,
  userRole,
  canManage,
  isGuest,
  signOut,
  // ... existing fields
};
```

### TypeScript type update

Update the `AuthContextType` interface:

```typescript
interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: 'super_admin' | 'admin' | 'user' | 'temp' | null;
  canManage: boolean;
  isGuest: boolean;
  signOut: () => Promise<void>;
  // ... existing fields
}
```

---

## 2. Audits Dashboard

**File**: `src/pages/AuditsDashboard.tsx`

### Remove manual user_id filter

The existing query likely has `.eq('user_id', user.id)`. **Remove that filter** — RLS now handles visibility via `can_view_audit()`. The query should just be:

```typescript
// BEFORE (remove):
const { data } = await supabase
  .from('audits')
  .select('*')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

// AFTER:
const { data } = await supabase
  .from('audits')
  .select('*')
  .order('created_at', { ascending: false });
```

RLS policies automatically filter: super_admin sees all, owners see theirs, granted users see assigned audits.

### Hide management buttons for guests

```tsx
const { canManage, isGuest } = useAuth();

// Hide "New Audit" / "Run Audit" button
{canManage && (
  <Button onClick={handleNewAudit}>New Audit</Button>
)}

// Hide delete action in audit list/cards
{canManage && (
  <Button variant="destructive" onClick={() => handleDelete(audit.id)}>
    Delete
  </Button>
)}
```

### Optional: show role badge

For non-owners, show a subtle badge indicating their access level:

```tsx
{isGuest && (
  <Badge variant="outline" className="text-xs">
    {userRole === 'temp' ? 'Preview Access' : 'Read-Only'}
  </Badge>
)}
```

---

## 3. Audit Detail Pages

Apply to all audit detail views (overview, keywords, clusters, technical, architecture, content, etc.).

### Hide write actions for guests

Use `canManage` from auth context to conditionally render:

```tsx
const { canManage } = useAuth();

// Hide "Share Report" button
{canManage && <ShareReportButton auditId={auditId} />}

// Hide "Generate Brief" / "Generate Content" buttons
{canManage && <Button onClick={handleGenerateBrief}>Generate Brief</Button>}

// Hide "Save" on client profile form
{canManage && <Button type="submit">Save Profile</Button>}

// Hide any edit/delete controls on individual items
{canManage && <EditButton />}
```

### Guest access indicator

Show a subtle indicator in the page header or sidebar:

```tsx
{isGuest && (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Eye className="h-4 w-4" />
    <span>View-only access</span>
  </div>
)}
```

---

## 4. What NOT to Change

These should remain exactly as they are:

- **`/share/:token` route** (`SharedAudit.tsx`) — anonymous token+password flow, completely separate from RBAC
- **`audit_shares` table** — unchanged
- **`share-audit` edge function** — no modifications
- **Login/signup flow** — standard Supabase Auth, no changes
- **ProtectedRoute component** — no route-level role checks needed (all logged-in users access `/audits/*`)

---

## 5. Database Schema Reference

These already exist in the database (migration applied). Provided for reference only — **do not create these**.

### `user_roles` table (existing)
```
user_id UUID (FK auth.users)
role    app_role enum ('super_admin' | 'admin' | 'moderator' | 'user' | 'temp')
UNIQUE(user_id, role)
```

### `audit_access` table (new)
```
id         UUID PK
audit_id   UUID FK audits(id) CASCADE
user_id    UUID FK auth.users(id) CASCADE
granted_by UUID FK auth.users(id)
expires_at TIMESTAMPTZ (null = permanent)
created_at TIMESTAMPTZ
revoked_at TIMESTAMPTZ (null = active)
UNIQUE(audit_id, user_id)
```

### `can_view_audit(uuid)` function
Returns `true` if `auth.uid()` is: super_admin, audit owner, or has active (non-revoked, non-expired) `audit_access` row.

---

## 6. Testing Checklist

After implementing, verify:

- [ ] Matt (super_admin) sees all audits, can create/delete/share
- [ ] Guest user (admin/user/temp role + audit_access row) sees only assigned audits
- [ ] Guest user cannot see New Audit, Delete, Share, Generate buttons
- [ ] Guest user sees "View-only access" indicator
- [ ] `/share/:token` anonymous links still work unchanged
- [ ] Auth context loads role without errors on login
- [ ] Users with no explicit role (null) behave as owners (backward compatible)
- [ ] Temp users with expired `expires_at` cannot see assigned audit (RLS blocks it)

---

## 7. User Management UI (Phase 2)

Admin-only page for super_admin to invite users, assign roles, and manage audit access. No SQL Editor needed.

### 7.1 Edge Function: `manage-users`

Required because user invitation and listing all users needs the service role key (not available client-side).

**Deploy as**: Supabase Edge Function (`supabase/functions/manage-users/index.ts`)

**Auth**: Every request must include the user's session JWT in `Authorization: Bearer <token>`. The function verifies the caller is `super_admin` by checking `user_roles` before processing.

#### Endpoints (action-based, single function)

**`POST /manage-users` with JSON body `{ action, ...params }`**

**Action: `invite`** — Create a new user and send invite email
```typescript
// Request
{ action: "invite", email: "partner@agency.com", role: "admin" }

// Implementation
const { data } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
// Then insert role:
await supabaseAdmin.from('user_roles').insert({
  user_id: data.user.id, role
});

// Response
{ success: true, user_id: "uuid", email: "partner@agency.com" }
```

**Action: `list`** — List all users with their roles and access grants
```typescript
// Request
{ action: "list" }

// Implementation
// 1. List all users from auth.users via admin API
const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
// 2. Query user_roles for all users
// 3. Query audit_access (joined with audits.domain) for all users
// 4. Merge and return

// Response
{
  users: [
    {
      id: "uuid",
      email: "partner@agency.com",
      role: "admin",
      created_at: "2026-03-10T...",
      last_sign_in_at: "2026-03-10T...",
      access: [
        { audit_id: "uuid", domain: "example.com", expires_at: null, revoked_at: null }
      ]
    }
  ]
}
```

**Action: `update_role`** — Change a user's role
```typescript
// Request
{ action: "update_role", user_id: "uuid", role: "user" }

// Implementation — delete old roles, insert new one
await supabaseAdmin.from('user_roles').delete().eq('user_id', user_id);
await supabaseAdmin.from('user_roles').insert({ user_id, role });

// Response
{ success: true }
```

**Action: `grant_access`** — Grant a user access to an audit
```typescript
// Request
{ action: "grant_access", user_id: "uuid", audit_id: "uuid", expires_in_days: 30 }
// expires_in_days is optional (null = permanent)

// Implementation
await supabaseAdmin.from('audit_access').upsert({
  audit_id,
  user_id,
  granted_by: caller_user_id,
  expires_at: expires_in_days ? new Date(Date.now() + expires_in_days * 86400000) : null,
  revoked_at: null  // clear revocation if re-granting
}, { onConflict: 'audit_id,user_id' });

// Response
{ success: true }
```

**Action: `revoke_access`** — Revoke a user's access to an audit
```typescript
// Request
{ action: "revoke_access", user_id: "uuid", audit_id: "uuid" }

// Implementation
await supabaseAdmin.from('audit_access')
  .update({ revoked_at: new Date().toISOString() })
  .eq('audit_id', audit_id)
  .eq('user_id', user_id);

// Response
{ success: true }
```

**Action: `delete_user`** — Remove user entirely
```typescript
// Request
{ action: "delete_user", user_id: "uuid" }

// Implementation
await supabaseAdmin.auth.admin.deleteUser(user_id);
// CASCADE handles user_roles + audit_access cleanup

// Response
{ success: true }
```

### 7.2 Route + Navigation

- Add route: `/admin/users` → `<AdminUsers />` component
- Wrap in `ProtectedRoute` — component itself checks `userRole === 'super_admin'`, redirects to `/audits` if not
- Add "Users" link in sidebar/nav, visible only when `userRole === 'super_admin'`
- Use a `Users` or `Shield` icon from lucide-react

### 7.3 Admin Users Page (`src/pages/AdminUsers.tsx`)

#### Layout

Two-panel layout:

**Left panel: User list**
- Table with columns: Email, Role (badge), Audits (count), Last Login, Actions
- Role badges: `super_admin` = purple, `admin` = blue, `user` = green, `temp` = orange
- "Invite User" button at top → opens invite dialog
- Click a row → shows user detail in right panel

**Right panel: User detail** (shown when a user is selected)
- User email + role at top
- Role selector dropdown (super_admin, admin, user, temp) with save button
- "Audit Access" section:
  - List of audits the user has access to, each showing: domain, granted date, expires_at, status (active/expired/revoked)
  - "Revoke" button on each active row
  - "Grant Access" button → opens audit picker dialog
- "Delete User" button at bottom (destructive, with confirmation dialog)

#### Invite User Dialog

```tsx
// Fields:
// - Email (required, text input)
// - Role (required, select: admin | user | temp)
// - Grant access to audits (optional, multi-select of existing audits by domain)
// - Expires in (optional, only shown for temp role: 7/14/30/90 days)

// On submit:
// 1. Call manage-users with action: "invite"
// 2. If audits selected, call action: "grant_access" for each
// 3. Show success toast with message "Invitation sent to {email}"
// 4. Refresh user list
```

#### Grant Access Dialog

```tsx
// Triggered from user detail panel "Grant Access" button
// - Audit picker: dropdown/search of all audits (fetched from audits table), displayed as domain
// - Expires in: optional, number input + unit (days), pre-filled to 30 for temp users
// On submit: call manage-users with action: "grant_access"
```

### 7.4 Data Fetching

```typescript
// Hook: useAdminUsers()
// Calls the edge function with action: "list" on mount
// Returns: { users, loading, error, refetch }

const fetchUsers = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await supabase.functions.invoke('manage-users', {
    body: { action: 'list' },
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  return res.data.users;
};

// All mutations go through the same edge function:
const invokeAction = async (body: any) => {
  const { data: { session } } = await supabase.auth.getSession();
  return supabase.functions.invoke('manage-users', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
};
```

### 7.5 What NOT to Build

- No self-service signup — users only get in via invitation
- No password reset UI — Supabase handles this via email automatically
- No role editing for the caller's own account (prevent locking yourself out)
- No bulk operations — one user at a time is fine for now

### 7.6 Testing Checklist

- [ ] Only super_admin can see "Users" nav link and access `/admin/users`
- [ ] Non-super_admin visiting `/admin/users` redirects to `/audits`
- [ ] Invite sends email and creates user with correct role
- [ ] Invited user can log in and sees only granted audits
- [ ] Role change takes effect on next page load for target user
- [ ] Grant access → user immediately sees the audit in their dashboard
- [ ] Revoke access → user no longer sees the audit
- [ ] Temp user with expired access cannot see the audit
- [ ] Delete user removes them from user list and all access
- [ ] Cannot delete your own account
