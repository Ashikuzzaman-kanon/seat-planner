"use client";

import { TabView, TabPanel } from "primereact/tabview";
import { ConfirmDialog } from "primereact/confirmdialog";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import StationManager from "@/components/network/StationManager";
import TrainManager from "@/components/network/TrainManager";
import FareManager from "@/components/network/FareManager";
import SeatAttributeManager from "@/components/network/SeatAttributeManager";
import "@/components/network/network.css";

export default function NetworkPage() {
  const { hasPermission } = useAuth();

  if (!hasPermission(PERMISSIONS.NETWORK_VIEW)) {
    return (
      <div className="card">
        <h1 className="page-title">Network</h1>
        <p className="page-subtitle">You do not have permission to view the network.</p>
      </div>
    );
  }

  return (
    <div>
      <ConfirmDialog />

      <h1 className="page-title">Network</h1>
      <p className="page-subtitle">
        What the railway physically is — the stations, the trains that run between them, what a
        journey costs, and what a seat can offer.
      </p>

      <div className="card">
        <TabView>
          <TabPanel header="Stations" leftIcon="pi pi-map-marker mr-2">
            <StationManager />
          </TabPanel>
          <TabPanel header="Trains & Routes" leftIcon="pi pi-directions mr-2">
            <TrainManager />
          </TabPanel>
          <TabPanel header="Fares" leftIcon="pi pi-dollar mr-2">
            <FareManager />
          </TabPanel>
          <TabPanel header="Seat Attributes" leftIcon="pi pi-sliders-h mr-2">
            <SeatAttributeManager />
          </TabPanel>
        </TabView>
      </div>
    </div>
  );
}
