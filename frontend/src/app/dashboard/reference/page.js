"use client";

import { TabView, TabPanel } from "primereact/tabview";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { Message } from "primereact/message";
import Link from "next/link";
import ReferenceManager from "@/components/reference/ReferenceManager";
import CoachClassManager from "@/components/reference/CoachClassManager";
import { coachTypesApi } from "@/lib/reference";
import "@/components/reference/reference.css";

export default function ReferencePage() {
  const { hasPermission } = useAuth();

  if (!hasPermission(PERMISSIONS.REFERENCE_MANAGE)) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Access denied</h2>
        <p style={{ color: "#6b7280" }}>
          You need reference-management permissions to view this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Reference Data</h1>
      <p className="page-subtitle">
        The coach types and classes that planners choose from when building a layout.
      </p>

      <Message
        severity="info"
        style={{ width: "100%", marginBottom: "1rem" }}
        content={
          <span>
            Looking for trains? They moved to{" "}
            <Link href="/dashboard/network" style={{ fontWeight: 600 }}>
              Network &rarr; Trains
            </Link>
            , where a train also carries its codes, route, coaches and schedule. These were always
            the same records &mdash; this screen only ever showed the name.
          </span>
        }
      />

      <div className="card">
        <TabView>
          {/* Trains outgrew this screen — they carry codes, routes, composition
              and schedules now, and all of that lives under Network → Trains. */}
          <TabPanel header="Coach Types" leftIcon="pi pi-box mr-2">
            <ReferenceManager title="Coach Types" singular="Coach type" apiClient={coachTypesApi} />
          </TabPanel>
          {/*
            Coach classes have their own manager: they carry standing capacity
            as well as a name, and the generic one only knows about names.
          */}
          <TabPanel header="Coach Classes" leftIcon="pi pi-star mr-2">
            <CoachClassManager />
          </TabPanel>
        </TabView>
      </div>
    </div>
  );
}
