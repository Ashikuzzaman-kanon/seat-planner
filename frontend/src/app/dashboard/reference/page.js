"use client";

import { TabView, TabPanel } from "primereact/tabview";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import ReferenceManager from "@/components/reference/ReferenceManager";
import { trainNamesApi, coachTypesApi, coachClassesApi } from "@/lib/reference";

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
        Manage the train names, coach types, and classes that planners choose from.
      </p>

      <div className="card">
        <TabView>
          <TabPanel header="Train Names" leftIcon="pi pi-bookmark mr-2">
            <ReferenceManager title="Train Names" singular="Train name" apiClient={trainNamesApi} />
          </TabPanel>
          <TabPanel header="Coach Types" leftIcon="pi pi-box mr-2">
            <ReferenceManager title="Coach Types" singular="Coach type" apiClient={coachTypesApi} />
          </TabPanel>
          <TabPanel header="Coach Classes" leftIcon="pi pi-star mr-2">
            <ReferenceManager title="Coach Classes" singular="Coach class" apiClient={coachClassesApi} />
          </TabPanel>
        </TabView>
      </div>
    </div>
  );
}
