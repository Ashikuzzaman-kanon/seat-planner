"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { RadioButton } from "primereact/radiobutton";
import { MultiSelect } from "primereact/multiselect";
import { AutoComplete } from "primereact/autocomplete";
import { InputTextarea } from "primereact/inputtextarea";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/constants/roles";
import { fetchFeatures, saveFeature, searchPeople, STATE_LABELS } from "@/lib/features";
import "./featureSwitches.css";

const MESSAGE_MAX = 300;

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Dhaka",
      })
    : "";

/** "Off for 2 people and 1 role", or the plain state. */
function stateText(feature) {
  if (feature.state !== "off_some") return STATE_LABELS[feature.state];
  const parts = [
    feature.users.length && `${feature.users.length} ${feature.users.length === 1 ? "person" : "people"}`,
    feature.roles.length && `${feature.roles.length} role${feature.roles.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `Off for ${parts.join(" and ")}`;
}

const SEVERITY = { on: "success", off_all: "danger", off_some: "warning" };

/**
 * Settings → Features: switch any tab of the app off, for everyone or for
 * chosen people and roles. Super admin only.
 *
 * A switch applies to the super admin too, and the dialog says so before it is
 * saved. Settings itself has no switch, so this screen is always the way back.
 */
export default function FeatureSwitches({ toast }) {
  const { user, roles: myRoles, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchFeatures());
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Features", detail: err.message });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const f of data.features) {
      let group = out.find((g) => g.name === f.group);
      if (!group) out.push((group = { name: f.group, items: [] }));
      group.items.push(f);
    }
    return out;
  }, [data]);

  const offCount = data ? data.features.filter((f) => f.state !== "on").length : 0;

  const saved = async (feature) => {
    setData((prev) => ({ ...prev, features: prev.features.map((f) => (f.key === feature.key ? feature : f)) }));
    setEditing(null);
    toast.current?.show({
      severity: "success",
      summary: feature.label,
      detail: feature.state === "on" ? "Switched on" : stateText(feature),
    });
    // Your own menu follows at once if the change was yours to feel.
    await refresh();
  };

  return (
    <div className="card fs" style={{ marginBottom: "1.5rem" }}>
      <div className="fs__head">
        <div>
          <h3 style={{ margin: 0 }}>Features</h3>
          <p className="fs__intro">
            Switch a tab off for everyone, or for chosen people and roles. It disappears from their menu, its address
            shows that it is unavailable, and the server refuses it. It applies to you too — Settings always stays,
            so you can switch things back on here.
          </p>
        </div>
        {data && (
          <Tag
            value={offCount ? `${offCount} switched off` : "Everything on"}
            severity={offCount ? "warning" : "success"}
          />
        )}
      </div>

      {!data ? (
        <div className="fs__loading">
          <ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="4" />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.name} className="fs__group">
            <h4>{group.name}</h4>
            <ul className="fs__list">
              {group.items.map((f) => (
                <li key={f.key} className={`fs__row${f.state === "on" ? "" : " is-off"}`}>
                  <div className="fs__what">
                    <strong>{f.label}</strong>
                    <Tag value={stateText(f)} severity={SEVERITY[f.state]} />
                  </div>
                  <div className="fs__detail">
                    {f.state === "off_some" && (
                      <span>
                        {[...f.roles.map((r) => roleLabel(r.name)), ...f.users.map((u) => u.fullName)].join(", ")}
                      </span>
                    )}
                    {f.state !== "on" && f.message && <span className="fs__message">“{f.message}”</span>}
                    {f.updatedBy && (
                      <small>
                        Changed by {f.updatedBy.fullName}, {when(f.updatedAt)}
                      </small>
                    )}
                  </div>
                  <Button
                    label="Change"
                    size="small"
                    outlined
                    onClick={() => setEditing(f)}
                    aria-label={`Change ${f.label}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <SwitchDialog
        feature={editing}
        roles={data?.roles || []}
        me={{ id: user?.id, roleIds: (myRoles || []).map((r) => r.id) }}
        onHide={() => setEditing(null)}
        onSaved={saved}
        toast={toast}
      />
    </div>
  );
}

function SwitchDialog({ feature, roles, me, onHide, onSaved, toast }) {
  const [state, setState] = useState("on");
  const [roleIds, setRoleIds] = useState([]);
  const [people, setPeople] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Start from the switch as it is, each time the dialog opens.
  useEffect(() => {
    if (!feature) return;
    setState(feature.state);
    setRoleIds(feature.roles.map((r) => r.id));
    setPeople(feature.users);
    setMessage(feature.message || "");
    setBusy(false);
  }, [feature]);

  const find = async (e) => {
    try {
      const found = await searchPeople(e.query);
      setSuggestions(found.filter((p) => !people.some((x) => x.id === p.id)));
    } catch {
      setSuggestions([]);
    }
  };

  const chosenNone = state === "off_some" && !roleIds.length && !people.length;
  const includesMe =
    state === "off_all" ||
    (state === "off_some" && (people.some((p) => p.id === me.id) || roleIds.some((id) => me.roleIds.includes(id))));

  const save = async () => {
    setBusy(true);
    try {
      const feature2 = await saveFeature(feature.key, {
        state,
        message: state === "on" ? null : message.trim() || null,
        userIds: state === "off_some" ? people.map((p) => p.id) : [],
        roleIds: state === "off_some" ? roleIds : [],
      });
      await onSaved(feature2);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not saved", detail: err.message });
      setBusy(false);
    }
  };

  const option = (value, label, hint) => (
    <label className={`fs-option${state === value ? " is-on" : ""}`} htmlFor={`fs-${value}`}>
      <RadioButton inputId={`fs-${value}`} value={value} checked={state === value} onChange={(e) => setState(e.value)} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );

  return (
    <Dialog
      header={feature ? `${feature.label}` : ""}
      visible={Boolean(feature)}
      onHide={busy ? () => {} : onHide}
      style={{ width: "36rem", maxWidth: "94vw" }}
      draggable={false}
      footer={
        <div className="fs-dialog__actions">
          <Button label="Cancel" text onClick={onHide} disabled={busy} />
          <Button label="Save" icon="pi pi-check" onClick={save} loading={busy} disabled={chosenNone} />
        </div>
      }
    >
      {feature && (
        <div className="fs-dialog">
          <div className="fs-options" role="radiogroup" aria-label="Switch">
            {option("on", "On", "Everyone who may use it sees it.")}
            {option("off_all", "Off for everyone", "Nobody sees it — you included.")}
            {option("off_some", "Off for chosen people and roles", "Everyone else still sees it.")}
          </div>

          {state === "off_some" && (
            <div className="fs-targets">
              <label htmlFor="fs-roles">Roles</label>
              <MultiSelect
                inputId="fs-roles"
                value={roleIds}
                options={roles}
                optionLabel="name"
                optionValue="id"
                itemTemplate={(r) => roleLabel(r.name)}
                selectedItemTemplate={(id) => {
                  const r = roles.find((x) => x.id === id);
                  return r ? roleLabel(r.name) : null;
                }}
                onChange={(e) => setRoleIds(e.value)}
                placeholder="No roles"
                display="chip"
                className="w-full"
              />
              <label htmlFor="fs-people">People</label>
              <AutoComplete
                inputId="fs-people"
                multiple
                value={people}
                suggestions={suggestions}
                completeMethod={find}
                field="fullName"
                itemTemplate={(p) => (
                  <span className="fs-person">
                    <strong>{p.fullName}</strong> <small>{p.email}</small>
                  </span>
                )}
                onChange={(e) => setPeople(e.value || [])}
                placeholder={people.length ? "" : "Type a name or email"}
                className="w-full"
              />
              {chosenNone && <small className="fs-hint">Choose at least one role or person.</small>}
            </div>
          )}

          {state !== "on" && (
            <div className="fs-message">
              <label htmlFor="fs-message">
                Message <span>— shown in place of the page (optional)</span>
              </label>
              <InputTextarea
                id="fs-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                autoResize
                maxLength={MESSAGE_MAX}
                placeholder="e.g. Back on Friday"
                className="w-full"
              />
              <small className="fs-hint">
                {message.trim().length} / {MESSAGE_MAX}
              </small>
            </div>
          )}

          {includesMe && (
            <Message
              severity="warn"
              text={`This includes you: ${feature.label} will leave your menu too. You can switch it back on here in Settings.`}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}
