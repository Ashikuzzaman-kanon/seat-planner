"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { fetchSettings, updateSetting } from "@/lib/settings";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";

import { TIP } from "@/components/ui/tip";
import "./settings.css";
export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  const canManage = hasPermission(PERMISSIONS.SETTING_MANAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSettings();
      setSettings(list);
      setDrafts(Object.fromEntries(list.map((s) => [s.key, s.value])));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(
    () =>
      settings.reduce((acc, setting) => {
        (acc[setting.group] ||= []).push(setting);
        return acc;
      }, {}),
    [settings]
  );

  const save = async (setting) => {
    setSavingKey(setting.key);
    try {
      const updated = await updateSetting(setting.key, drafts[setting.key]);
      setSettings((prev) => prev.map((s) => (s.key === updated.key ? updated : s)));
      setDrafts((prev) => ({ ...prev, [updated.key]: updated.value }));
      toast.current?.show({
        severity: "success",
        summary: "Saved",
        detail: `${updated.label} is now ${updated.value}`,
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
      // Put the field back to the stored value so the form never lies.
      setDrafts((prev) => ({ ...prev, [setting.key]: setting.value }));
    } finally {
      setSavingKey(null);
    }
  };

  /** The editor is chosen by the declared type, so new settings need no UI work. */
  const renderEditor = (setting) => {
    const value = drafts[setting.key];
    const onChange = (v) => setDrafts((prev) => ({ ...prev, [setting.key]: v }));
    const disabled = !canManage || savingKey === setting.key;

    if (setting.type === "boolean") {
      return <InputSwitch checked={!!value} disabled={disabled} onChange={(e) => onChange(e.value)} />;
    }
    if (setting.type === "integer" || setting.type === "decimal") {
      return (
        <InputNumber
          value={value}
          disabled={disabled}
          min={setting.min}
          max={setting.max}
          maxFractionDigits={setting.type === "decimal" ? 2 : 0}
          onValueChange={(e) => onChange(e.value)}
          style={{ width: "10rem" }}
          // The input inside sizes itself from its own `size` attribute and
          // spilled past the 10rem wrapper, over the Save button beside it.
          inputStyle={{ width: "100%", minWidth: 0 }}
        />
      );
    }
    return (
      <InputText
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "16rem" }}
      />
    );
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
        <ProgressSpinner />
      </div>
    );
  }

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">
        Runtime-configurable values. Changes take effect immediately — no restart or deploy.
        {!canManage && " You have read-only access."}
      </p>

      {Object.entries(grouped).map(([group, entries]) => (
        <div className="card" key={group} style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginTop: 0 }}>{group}</h3>

          {entries.map((setting) => {
            const dirty = drafts[setting.key] !== setting.value;
            return (
              <div key={setting.key} className="setting-row">
                <div className="setting-row__text">
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}
                  >
                    <span style={{ fontWeight: 600 }}>{setting.label}</span>
                    {setting.isDefault ? (
                      <Tag value="Default" severity="secondary" />
                    ) : (
                      <Tag value="Overridden" severity="info" />
                    )}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "0.25rem" }}>
                    {setting.description}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    <code>{setting.key}</code>
                    {setting.min !== undefined && ` · range ${setting.min}–${setting.max}`}
                    {` · default ${setting.default}`}
                  </div>
                </div>

                <div className="setting-row__edit">
                  {renderEditor(setting)}
                  <Button aria-label={dirty ? "Save" : "No change"} tooltipOptions={TIP}
                    icon="pi pi-check"
                    size="small"
                    disabled={!canManage || !dirty}
                    loading={savingKey === setting.key}
                    onClick={() => save(setting)}
                    tooltip={dirty ? "Save" : "No change"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
