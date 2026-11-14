"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import Select from "@/components/ui/Select";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { Toast } from "primereact/toast";
import { TabView, TabPanel } from "primereact/tabview";
import { fetchAuditEvents } from "@/lib/audit";
import { whenBody, actionBody, actorBody, entityBody, expansion } from "@/components/audit/eventCells";
import AuditAnalysis from "@/components/audit/AuditAnalysis";

const PAGE_SIZE = 25;

/**
 * The audit log: the events one by one (Log), and the same events analysed —
 * by operation, person, time of day, day of the week… (Analysis). The
 * Analysis tab's address ends in #analysis.
 */
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
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (window.location.hash === "#analysis") setTab(1);
  }, []);
  const chooseTab = (index) => {
    setTab(index);
    window.history.replaceState(null, "", index === 1 ? "#analysis" : window.location.pathname);
  };

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

      <TabView className="audit-tabs" activeIndex={tab} onTabChange={(e) => chooseTab(e.index)} renderActiveOnly={false}>
        <TabPanel header="Log" leftIcon="pi pi-list mr-2">
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
                <Checkbox inputId="hide-tests" checked={hideTests} onChange={(e) => setHideTests(e.checked)} />
                <label htmlFor="hide-tests">Hide automated test activity</label>
              </div>
              <div className="ui-toolbar__spacer" />
              <Button icon="pi pi-refresh" label="Refresh" outlined onClick={() => load(pagination.page, action, hideTests)} />
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
        </TabPanel>
        <TabPanel header="Analysis" leftIcon="pi pi-chart-bar mr-2">
          <AuditAnalysis active={tab === 1} />
        </TabPanel>
      </TabView>
    </div>
  );
}
