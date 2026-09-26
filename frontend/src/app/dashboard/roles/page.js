"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { Toast } from "primereact/toast";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import {
  fetchRoles,
  fetchPermissionCatalogue,
  createRole,
  updateRole,
  deleteRole,
} from "@/lib/roles";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { roleLabel, roleSeverity } from "@/constants/roles";

import { tip } from "@/components/ui/tip";
const EMPTY_FORM = { id: null, name: "", description: "", permissions: [] };

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [roles, setRoles] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const canCreate = hasPermission(PERMISSIONS.ROLE_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.ROLE_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.ROLE_DELETE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roleList, permissionList] = await Promise.all([
        fetchRoles(),
        fetchPermissionCatalogue(),
      ]);
      setRoles(roleList);
      setCatalogue(permissionList);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    return catalogue.reduce((acc, entry) => {
      (acc[entry.group] ||= []).push(entry);
      return acc;
    }, {});
  }, [catalogue]);

  const grantableKeys = useMemo(
    () => new Set(catalogue.filter((p) => p.grantable).map((p) => p.key)),
    [catalogue]
  );

  /**
   * A role can only be edited if every permission it *currently* holds is one
   * the caller holds too — the same rule the server applies, so the UI doesn't
   * offer an action that is certain to be rejected.
   */
  const canManageRole = useCallback(
    (role) =>
      !role.isSystem && (role.permissions || []).every((key) => grantableKeys.has(key)),
    [grantableKeys]
  );

  const openCreate = () => setForm({ ...EMPTY_FORM });

  const openEdit = (role) =>
    setForm({
      id: role.id,
      name: role.name,
      description: role.description || "",
      permissions: [...(role.permissions || [])],
    });

  const togglePermission = (key) =>
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((k) => k !== key)
        : [...prev.permissions, key],
    }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissions: form.permissions,
      };
      if (form.id) {
        const updated = await updateRole(form.id, payload);
        setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        toast.current?.show({ severity: "success", summary: `Updated "${updated.name}"` });
      } else {
        const created = await createRole(payload);
        setRoles((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        toast.current?.show({ severity: "success", summary: `Created "${created.name}"` });
      }
      setForm(null);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (role) =>
    confirmDialog({
      message: `Delete the role "${roleLabel(role.name)}"? Anyone holding it loses its permissions immediately.`,
      header: "Delete role",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await deleteRole(role.id);
          setRoles((prev) => prev.filter((r) => r.id !== role.id));
          toast.current?.show({ severity: "success", summary: `Deleted "${role.name}"` });
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Delete failed",
            detail: err.message,
          });
        }
      },
    });

  const nameBody = (role) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <Tag value={roleLabel(role.name)} severity={roleSeverity(role.name)} />
      {role.isSystem && <Tag value="System" severity="danger" icon="pi pi-lock" />}
      {role.isDefault && <Tag value="Default" severity="info" icon="pi pi-star" />}
    </div>
  );

  const permissionsBody = (role) => {
    if (role.isSystem) {
      return <span style={{ color: "#6b7280" }}>All permissions (implicit)</span>;
    }
    const count = role.permissions?.length || 0;
    return count ? `${count} permission${count > 1 ? "s" : ""}` : "None";
  };

  const actionsBody = (role) => {
    const manageable = canManageRole(role);
    return (
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button
          {...tip(
            role.isSystem
              ? "System roles cannot be modified"
              : !manageable
                ? "This role holds permissions you do not have"
                : "Edit role"
          )}
          icon="pi pi-pencil"
          size="small"
          outlined
          disabled={!canUpdate || !manageable}
          onClick={() => openEdit(role)}
        />
        <Button
          {...tip(
            role.isDefault
              ? "The default role cannot be deleted"
              : role.isSystem
                ? "System roles cannot be deleted"
                : !manageable
                  ? "This role holds permissions you do not have"
                  : "Delete role"
          )}
          icon="pi pi-trash"
          size="small"
          outlined
          severity="danger"
          disabled={!canDelete || !manageable || role.isDefault}
          onClick={() => confirmDelete(role)}
        />
      </div>
    );
  };

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <h1 className="page-title">Roles &amp; Permissions</h1>
      <p className="page-subtitle">
        Roles are built at runtime from the permission catalogue. You can only grant permissions
        you already hold yourself, so no role you create can be more powerful than you are.
      </p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
          <Button
            label="New role"
            icon="pi pi-plus"
            disabled={!canCreate}
            onClick={openCreate}
          />
        </div>

        <DataTable
          value={roles}
          loading={loading}
          dataKey="id"
          emptyMessage="No roles defined"
          stripedRows
        >
          <Column header="Role" body={nameBody} />
          <Column field="description" header="Description" bodyClassName="ui-cell--text" />
          <Column header="Permissions" body={permissionsBody} />
          <Column header="Actions" body={actionsBody} style={{ width: "8rem" }} />
        </DataTable>
      </div>

      <Dialog
        header={form?.id ? `Edit role "${form.name}"` : "New role"}
        visible={!!form}
        style={{ width: "44rem", maxWidth: "95vw" }}
        onHide={() => setForm(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setForm(null)} disabled={saving} />
            <Button
              label="Save"
              icon="pi pi-check"
              onClick={save}
              loading={saving}
              disabled={!form?.name?.trim()}
            />
          </>
        }
      >
        {form && (
          <>
            <div className="field-block">
              <label htmlFor="role-name">Name</label>
              <InputText
                id="role-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. ticket_checker"
                style={{ width: "100%" }}
              />
            </div>

            <div className="field-block">
              <label htmlFor="role-description">Description</label>
              <InputTextarea
                id="role-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                Permissions ({form.permissions.length} selected)
              </div>
              <p style={{ margin: "0 0 0.75rem", color: "#6b7280", fontSize: "0.85rem" }}>
                Greyed-out permissions are ones you do not hold, so you cannot grant them.
              </p>

              {Object.entries(grouped).map(([group, entries]) => (
                <div key={group} style={{ marginBottom: "1rem" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "#6b7280",
                      marginBottom: "0.4rem",
                    }}
                  >
                    {group}
                  </div>
                  {entries.map((entry) => {
                    const checked = form.permissions.includes(entry.key);
                    const blocked = !entry.grantable;
                    return (
                      <div
                        key={entry.key}
                        style={{
                          display: "flex",
                          gap: "0.6rem",
                          alignItems: "flex-start",
                          padding: "0.35rem 0",
                          opacity: blocked ? 0.45 : 1,
                        }}
                      >
                        <Checkbox
                          inputId={entry.key}
                          checked={checked}
                          disabled={blocked}
                          onChange={() => togglePermission(entry.key)}
                        />
                        <label htmlFor={entry.key} style={{ cursor: blocked ? "default" : "pointer" }}>
                          <div style={{ fontWeight: 500 }}>{entry.label}</div>
                          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                            {entry.description}
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
