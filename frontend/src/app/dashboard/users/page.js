"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import SearchBox from "@/components/ui/SearchBox";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { InputTextarea } from "primereact/inputtextarea";
import api from "@/lib/api";
import Select from "@/components/ui/Select";
import PersonLink from "@/components/people/PersonLink";
import { useAccountChanges } from "@/components/people/ProfileProvider";
import { liftRestrictions, restrictAccounts } from "@/lib/people";
import { fetchRoles, setUserRoles } from "@/lib/roles";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import StandingDialog from "@/components/checking/StandingDialog";
import { roleLabel, roleSeverity, SUPER_ADMIN_ROLE } from "@/constants/roles";

export default function UsersPage() {
  const { user: me, permissions, hasPermission, hasRole } = useAuth();
  const toast = useRef(null);

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState(null); // "restrict" | "lift"
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Opened from a profile's "Edit roles": search for that account, then open its editor.
  const pendingEdit = useRef(null);

  const canManage = hasPermission(PERMISSIONS.USER_MANAGE_ROLES);
  // Reading an account's standing is a reviewer's permission, not a user
  // administrator's — seeing the score is separate from being able to act on it.
  const canReview = hasPermission(PERMISSIONS.ABUSE_REVIEW);
  const canSeeRoles = hasPermission(PERMISSIONS.ROLE_VIEW);
  const canRestrict = hasPermission(PERMISSIONS.USER_RESTRICT);
  const amSuperAdmin = hasRole(SUPER_ADMIN_ROLE);

  const fetchUsers = useCallback(async (searchValue = "", statusValue = null) => {
    setLoading(true);
    try {
      const { data } = await api.get("/users", {
        params: { search: searchValue, limit: 100, status: statusValue || undefined },
      });
      setUsers(data.users);
      // Keep only what is still on the page selected.
      setSelected((was) => was.filter((s) => data.users.some((u) => u.id === s.id)));
      if (pendingEdit.current) {
        const row = data.users.find((u) => u.id === pendingEdit.current);
        if (row) {
          pendingEdit.current = null;
          openEditor(row);
        }
      }
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("edit")) pendingEdit.current = Number(params.get("edit"));
    if (params.get("q")) setSearch(params.get("q"));
  }, []);

  // Restricting or lifting from a profile window changes the list.
  useAccountChanges(() => fetchUsers(search, status));

  useEffect(() => {
    if (canSeeRoles) fetchRoles().then(setRoles).catch(() => setRoles([]));
  }, [canSeeRoles]);

  useEffect(() => {
    const t = setTimeout(() => fetchUsers(search, status), 350);
    return () => clearTimeout(t);
  }, [search, status, fetchUsers]);

  const runBulk = async () => {
    const ids = selected.map((u) => u.id);
    setBulkBusy(true);
    try {
      const outcome = bulk === "restrict" ? await restrictAccounts(ids, bulkText.trim()) : await liftRestrictions(ids, bulkText.trim());
      const refused = outcome.results.filter((r) => !r.done);
      const nameOf = (id) => users.find((u) => u.id === id)?.fullName || `account ${id}`;
      toast.current?.show({
        severity: refused.length ? (outcome.done ? "warn" : "error") : "success",
        summary: `${bulk === "restrict" ? "Restricted" : "Restriction lifted on"} ${outcome.done} of ${ids.length}`,
        detail: refused.length ? refused.map((r) => `${nameOf(r.userId)}: ${r.error}`).join(" · ") : undefined,
        life: refused.length ? 9000 : 4500,
      });
      setBulk(null);
      setBulkText("");
      setSelected([]);
      await fetchUsers(search, status);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "That did not work", detail: err.message });
    } finally {
      setBulkBusy(false);
    }
  };

  /**
   * Mirrors the server's escalation guard so un-assignable roles are visibly
   * disabled rather than failing on save. The server remains the real check.
   */
  const roleOptions = useMemo(() => {
    const held = new Set(permissions);
    return roles.map((role) => {
      const blocked =
        !amSuperAdmin &&
        (role.name === SUPER_ADMIN_ROLE ||
          (role.permissions || []).some((p) => !held.has(p)));
      return {
        label: roleLabel(role.name),
        value: role.id,
        disabled: blocked,
        role,
      };
    });
  }, [roles, permissions, amSuperAdmin]);

  const openEditor = (target) => {
    setEditing(target);
    setSelectedRoleIds((target.roles || []).map((r) => r.id));
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await setUserRoles(editing.id, selectedRoleIds);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.current?.show({
        severity: "success",
        summary: "Roles updated",
        detail: `${updated.fullName} now holds ${updated.roles.length} role(s)`,
      });
      setEditing(null);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Update failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const rolesBody = (row) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
      {row.roles?.length ? (
        row.roles.map((r) => (
          <Tag key={r.id} value={roleLabel(r.name)} severity={roleSeverity(r.name)} />
        ))
      ) : (
        <span style={{ color: "#9ca3af" }}>None</span>
      )}
    </div>
  );

  const verifiedBody = (row) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
      {row.restrictedAt && <Tag value="Restricted" severity="danger" icon="pi pi-lock" />}
      {row.isVerified ? (
        <Tag value="Verified" severity="success" icon="pi pi-check" />
      ) : (
        <Tag value="Pending" severity="warning" icon="pi pi-clock" />
      )}
    </div>
  );

  const nameBody = (row) => <PersonLink id={row.id} name={row.fullName} />;

  /*
   * Which account's standing is open.
   *
   * Reaching this only through a report — which is how it started — meant an
   * account nobody happened to report could not be looked at at all. Somebody
   * you have a reason to suspect is exactly the account with no report against
   * it yet.
   */
  const [showing, setShowing] = useState(null);

  const actionBody = (row) => {
    const isSelf = row.id === me.id;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Button
          label="Edit roles"
          icon="pi pi-pencil"
          size="small"
          outlined
          disabled={!canManage || isSelf}
          onClick={() => openEditor(row)}
        />
        {canReview && (
          <Button
            label="Standing"
            icon="pi pi-chart-bar"
            size="small"
            text
            onClick={() => setShowing({ id: row.id, name: row.fullName })}
          />
        )}
        {isSelf && <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>(you)</span>}
      </div>
    );
  };

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Users</h1>
      <p className="page-subtitle">
        A user may hold several roles at once — their permissions are the union of all of them.
        You can only grant roles whose permissions you hold yourself.
      </p>

      <div className="card">
        <div className="ui-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" />
          <Select
            value={status}
            options={[
              { label: "All accounts", value: null },
              { label: "Restricted", value: "restricted" },
              { label: "Not restricted", value: "active" },
            ]}
            onChange={(e) => setStatus(e.value)}
            placeholder="All accounts"
            aria-label="Show"
            style={{ width: "auto", minWidth: "11rem" }}
          />
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={() => fetchUsers(search, status)} />
        </div>

        {canRestrict && selected.length > 0 && (
          <div className="users-bulk" role="region" aria-label="Selected accounts">
            <strong>{selected.length} selected</strong>
            <Button label="Restrict" icon="pi pi-lock" size="small" severity="danger" outlined onClick={() => setBulk("restrict")} />
            <Button label="Lift restriction" icon="pi pi-lock-open" size="small" outlined onClick={() => setBulk("lift")} />
            <Button label="Clear" size="small" text onClick={() => setSelected([])} />
          </div>
        )}

        <DataTable
          value={users}
          loading={loading}
          paginator
          rows={10}
          dataKey="id"
          emptyMessage="No users found"
          stripedRows
          {...(canRestrict
            ? { selectionMode: "checkbox", selection: selected, onSelectionChange: (e) => setSelected(e.value) }
            : {})}
        >
          {canRestrict && <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />}
          <Column field="fullName" header="Name" sortable body={nameBody} />
          <Column field="email" header="Email" sortable />
          <Column header="Status" body={verifiedBody} />
          <Column header="Roles" body={rolesBody} />
          <Column header="Actions" body={actionBody} />
        </DataTable>
      </div>

      <Dialog
        header={bulk === "restrict" ? `Restrict ${selected.length} account${selected.length === 1 ? "" : "s"}?` : `Lift the restriction on ${selected.length}?`}
        visible={Boolean(bulk)}
        style={{ width: "min(30rem, calc(100vw - 2rem))" }}
        onHide={() => (bulkBusy ? null : setBulk(null))}
        draggable={false}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setBulk(null)} disabled={bulkBusy} />
            <Button
              label={bulk === "restrict" ? "Restrict" : "Lift restriction"}
              icon={bulk === "restrict" ? "pi pi-lock" : "pi pi-lock-open"}
              severity={bulk === "restrict" ? "danger" : undefined}
              onClick={runBulk}
              loading={bulkBusy}
              disabled={bulk === "restrict" && !bulkText.trim()}
            />
          </>
        }
      >
        <p style={{ marginTop: 0, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {bulk === "restrict"
            ? "They are signed out everywhere at once, and cannot sign in or use the subscription check until the restriction is lifted. Accounts you may not restrict are left alone and listed afterwards."
            : "They can sign in again straight away."}
        </p>
        <label htmlFor="bulk-text" style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}>
          {bulk === "restrict" ? "Reason" : "Note (optional)"}
        </label>
        <InputTextarea
          id="bulk-text"
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={2}
          autoResize
          maxLength={500}
          style={{ width: "100%" }}
          placeholder={bulk === "restrict" ? "Test accounts — off until needed" : ""}
        />
      </Dialog>

      <StandingDialog
        userId={showing?.id}
        name={showing?.name}
        onHide={() => setShowing(null)}
      />

      <Dialog
        header={editing ? `Roles for ${editing.fullName}` : ""}
        visible={!!editing}
        style={{ width: "32rem" }}
        onHide={() => setEditing(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setEditing(null)} disabled={saving} />
            <Button label="Save" icon="pi pi-check" onClick={save} loading={saving} />
          </>
        }
      >
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.85rem" }}>
          Greyed-out roles carry permissions you do not hold, so you cannot grant or revoke them.
        </p>
        <MultiSelect
          value={selectedRoleIds}
          options={roleOptions}
          onChange={(e) => setSelectedRoleIds(e.value)}
          optionDisabled="disabled"
          display="chip"
          placeholder="Select roles"
          style={{ width: "100%" }}
        />
      </Dialog>
    </div>
  );
}
