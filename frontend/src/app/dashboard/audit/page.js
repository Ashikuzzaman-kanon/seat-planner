"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import When from "@/components/ui/When";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import Select from "@/components/ui/Select";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { Toast } from "primereact/toast";
import { fetchAuditEvents } from "@/lib/audit";

const PAGE_SIZE = 25;

const ACTION_SEVERITY = {
  "role.create": "success",
  "role.update": "info",
  "role.delete": "danger",
  "user.roles.update": "warning",
  "setting.update": "info",
  "auth.login": "success",
  "auth.login_failed": "danger",
  "auth.register": "info",
  "auth.verify_email": "success",
  "auth.password_reset_request": "warning",
  "auth.password_reset": "warning",
  "auth.password_reset_failed": "danger",
  "demo.populate": "info",
  "demo.clear": "warning",
};

export default function AuditPage() {
  const toast = useRef(null);

  const [events, setEvents] = useState([]);
  const [actions, setActions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0 });
  const [available, setAvailable] = useState(true);
  const [action, setAction] = useState(null);
  // Default on: the automated suites generate far more events than people do.
  const [hideTests, setHideTests] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (page = 1, actionFilter = null, excludeTests = true) => {
    setLoading(true);
    try {
      const data = await fetchAuditEvents({ page, limit: PAGE_SIZE, action: actionFilter, excludeTests });
      setEvents(data.events);
      setPagination(data.pagination);
      setActions(data.actions || []);
      setAvailable(data.available !== false);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, action, hideTests);
  }, [load, action, hideTests]);

  const whenBody = (row) => <When value={row.at} extra={row.context?.requestId?.slice(0, 8)} />;

  const actionBody = (row) => (
    <Tag value={row.action} severity={ACTION_SEVERITY[row.action] || "secondary"} />
  );

  const actorBody = (row) => (
    <div>
      <div>{row.actor?.email || "system"}</div>
      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
        {(row.actor?.roles || []).join(", ")}
      </div>
    </div>
  );

  const entityBody = (row) =>
    row.entity?.type ? (
      <div>
        <div style={{ fontWeight: 500 }}>{row.entity.label || row.entity.id}</div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          {row.entity.type} #{row.entity.id}
        </div>
      </div>
    ) : (
      <span style={{ color: "#9ca3af" }}>—</span>
    );

  /** The before/after payload differs per action, so it is shown as raw detail. */
  const expansion = (row) => (
    <div style={{ padding: "0.75rem 1rem", background: "#f8fafc", fontSize: "0.8rem" }}>
      {row.message && (
        <div style={{ marginBottom: "0.5rem" }}>
          <strong>Summary:</strong> {row.message}
        </div>
      )}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "16rem" }}>
          <strong>Before</strong>
          <pre style={{ whiteSpace: "pre-wrap", margin: "0.25rem 0" }}>
            {JSON.stringify(row.before, null, 2) || "—"}
          </pre>
        </div>
        <div style={{ flex: 1, minWidth: "16rem" }}>
          <strong>After</strong>
          <pre style={{ whiteSpace: "pre-wrap", margin: "0.25rem 0" }}>
            {JSON.stringify(row.after, null, 2) || "—"}
          </pre>
        </div>
      </div>
      <div style={{ marginTop: "0.5rem", color: "#6b7280" }}>
        {row.context?.method} {row.context?.path} · {row.context?.ipAddress} · request{" "}
        {row.context?.requestId}
      </div>
    </div>
  );

  const [expanded, setExpanded] = useState(null);

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Audit Log</h1>
      <p className="page-subtitle">
        An append-only record of privileged actions — who did what, to which thing, and from where.
      </p>

      {!available && (
        <Message
          severity="warn"
          style={{ width: "100%", marginBottom: "1rem" }}
          text="The document store is unavailable, so no audit history can be shown. Actions still succeed — auditing degrades rather than blocking."
        />
      )}

      <div className="card">
        <div className="ui-toolbar">
          <Select
            value={action}
            options={actions.map((a) => ({ label: a, value: a }))}
            onChange={(e) => setAction(e.value)}
            placeholder="All actions"
            showClear
            style={{ minWidth: "16rem" }}
          />
          <div className="ui-toolbar__check">
            <Checkbox
              inputId="hide-tests"
              checked={hideTests}
              onChange={(e) => setHideTests(e.checked)}
            />
            <label htmlFor="hide-tests">Hide automated test activity</label>
          </div>
          <div className="ui-toolbar__spacer" />
          <Button
            icon="pi pi-refresh"
            label="Refresh"
            outlined
            onClick={() => load(pagination.page, action, hideTests)}
          />
        </div>

        <DataTable
          value={events}
          loading={loading}
          dataKey="_id"
          stripedRows
          emptyMessage={available ? "No events recorded yet" : "Audit history unavailable"}
          expandedRows={expanded}
          onRowToggle={(e) => setExpanded(e.data)}
          rowExpansionTemplate={expansion}
          lazy
          paginator
          rows={PAGE_SIZE}
          totalRecords={pagination.total}
          first={(pagination.page - 1) * PAGE_SIZE}
          onPage={(e) => load(Math.floor(e.first / PAGE_SIZE) + 1, action, hideTests)}
        >
          <Column expander style={{ width: "3rem" }} />
          <Column header="When" body={whenBody} style={{ width: "10rem" }} />
          <Column header="Action" body={actionBody} />
          <Column header="Actor" body={actorBody} />
          <Column header="Target" body={entityBody} />
        </DataTable>
      </div>
    </div>
  );
}
