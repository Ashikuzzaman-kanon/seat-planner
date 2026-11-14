import When from "@/components/ui/When";
import { Tag } from "primereact/tag";
import PersonLink from "@/components/people/PersonLink";

/*
 * One audit event, cell by cell — for the log and for the analysis's events
 * one by one, so both read alike.
 */

export const ACTION_SEVERITY = {
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
  "railway.load": "info",
  "railway.sync_check": "info",
  "railway.sync_apply": "warning",
  "trip.seats_cleared": "info",
  "auth.locked": "danger",
  "subscription.create": "success",
  "subscription.update": "info",
  "subscription.delete": "danger",
  "subscription.request": "info",
  "subscription.approve": "success",
  "subscription.decline": "warning",
  "subscription.cancel": "warning",
  "subscription.extend": "info",
  "subscription.resume": "success",
  "subscription.expire": "secondary",
  "subscription.limits": "info",
  "subscription.platform_create": "success",
  "subscription.platform_update": "info",
  "subscription.platform_delete": "danger",
  "subscription.device_add": "success",
  "subscription.device_update": "info",
  "subscription.check": "success",
  "subscription.device_delete": "danger",
  "subscription.seat_plans": "success",
  "subscription.app_link": "info",
  "subscription.app_notice": "info",
  "subscription.version_policy": "warning",
  "subscription.version_block": "danger",
  "subscription.version_unblock": "info",
  "account.restrict": "danger",
  "account.unrestrict": "success",
};

/**
 * One action whose entries end two ways. Every subscription check is the same
 * action whether it was answered yes or no, so the list says which: without
 * this a week of checks is a column of identical tags.
 */
export const WHEN_IT_FAILED = {
  "subscription.check": { severity: "warning", note: "not valid" },
  "subscription.seat_plans": { severity: "warning", note: "refused" },
};

export const whenBody = (row) => <When value={row.at} extra={row.context?.requestId?.slice(0, 8)} />;

export const actionBody = (row) => {
  const failed = row.outcome === "failure" ? WHEN_IT_FAILED[row.action] : null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
      <Tag value={row.action} severity={failed?.severity || ACTION_SEVERITY[row.action] || "secondary"} />
      {failed && <small style={{ color: "#b45309", fontWeight: 600 }}>{failed.note}</small>}
    </span>
  );
};

export const actorBody = (row) => (
  <div>
    <div>{row.actor?.email ? <PersonLink id={row.actor.id} name={row.actor.email} /> : "system"}</div>
    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
      {(row.actor?.roles || []).join(", ")}
    </div>
  </div>
);

export const entityBody = (row) =>
  row.entity?.type ? (
    <div>
      <div style={{ fontWeight: 500 }}>
        {row.entity.type === "user" ? (
          <PersonLink id={row.entity.id} name={row.entity.label || row.entity.id} />
        ) : (
          row.entity.label || row.entity.id
        )}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
        {row.entity.type} #{row.entity.id}
      </div>
    </div>
  ) : (
    <span style={{ color: "#9ca3af" }}>—</span>
  );

/** The before/after payload differs per action, so it is shown as raw detail. */
export const expansion = (row) => (
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
