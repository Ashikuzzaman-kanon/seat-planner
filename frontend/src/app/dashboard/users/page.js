"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  ALL_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_SEVERITY,
} from "@/constants/roles";

const ROLE_OPTIONS = ALL_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }));

export default function UsersPage() {
  const { user: me, hasPermission } = useAuth();
  const toast = useRef(null);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);

  const canManage = hasPermission(PERMISSIONS.USER_MANAGE_ROLES);

  const fetchUsers = useCallback(async (searchValue = "") => {
    setLoading(true);
    try {
      const { data } = await api.get("/users", {
        params: { search: searchValue, limit: 100 },
      });
      setUsers(data.users);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => fetchUsers(search), 350);
    return () => clearTimeout(t);
  }, [search, fetchUsers]);

  const applyRole = async (target, newRole) => {
    setSavingId(target.id);
    try {
      const { data } = await api.patch(`/users/${target.id}/role`, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? data.user : u)));
      toast.current?.show({
        severity: "success",
        summary: "Role updated",
        detail: `${target.fullName} is now ${ROLE_LABELS[newRole]}`,
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Update failed", detail: err.message });
    } finally {
      setSavingId(null);
    }
  };

  const onRoleChange = (target, newRole) => {
    if (newRole === target.role) return;
    confirmDialog({
      message: `Change ${target.fullName}'s role from "${ROLE_LABELS[target.role]}" to "${ROLE_LABELS[newRole]}"?`,
      header: "Confirm role change",
      icon: "pi pi-exclamation-triangle",
      accept: () => applyRole(target, newRole),
    });
  };

  const roleBodyTemplate = (row) => (
    <Tag value={ROLE_LABELS[row.role]} severity={ROLE_SEVERITY[row.role]} />
  );

  const verifiedBodyTemplate = (row) =>
    row.isVerified ? (
      <Tag value="Verified" severity="success" icon="pi pi-check" />
    ) : (
      <Tag value="Pending" severity="warning" icon="pi pi-clock" />
    );

  const actionBodyTemplate = (row) => {
    const isSelf = row.id === me.id;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Dropdown
          value={row.role}
          options={ROLE_OPTIONS}
          onChange={(e) => onRoleChange(row, e.value)}
          disabled={!canManage || isSelf || savingId === row.id}
          loading={savingId === row.id}
          style={{ minWidth: 160 }}
        />
        {isSelf && <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>(you)</span>}
      </div>
    );
  };

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <h1 className="page-title">Users &amp; Roles</h1>
      <p className="page-subtitle">
        Assign roles to registered users. Only super admins can change roles.
      </p>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "1rem",
            gap: "1rem",
          }}
        >
          <span className="p-input-icon-left">
            <i className="pi pi-search" />
            <InputText
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
            />
          </span>
          <Button
            icon="pi pi-refresh"
            label="Refresh"
            outlined
            onClick={() => fetchUsers(search)}
          />
        </div>

        <DataTable
          value={users}
          loading={loading}
          paginator
          rows={10}
          dataKey="id"
          emptyMessage="No users found"
          stripedRows
        >
          <Column field="fullName" header="Name" sortable />
          <Column field="email" header="Email" sortable />
          <Column header="Status" body={verifiedBodyTemplate} />
          <Column field="role" header="Current role" body={roleBodyTemplate} sortable />
          <Column header="Assign role" body={actionBodyTemplate} />
        </DataTable>
      </div>
    </div>
  );
}
