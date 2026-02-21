import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../services/supabaseClient";

const VehicleTracker: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const gpsIntervalRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Waiting for GPS updates...");

  useEffect(() => {
    if (!vehicleId) return;

    setStatus(`Tracking started for vehicle ${vehicleId}`);

    gpsIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          try {
            const { error: updateError } = await supabase
              .from("vehicles")
              .update({
                last_lat: latitude,
                last_lng: longitude,
                last_location_updated_at: new Date().toISOString(),
              })
              .eq("id", vehicleId);

            if (updateError) {
              throw new Error(updateError.message);
            }

            const { error: insertError } = await supabase
              .from("driver_gps_logs")
              .insert({
                vehicle_id: vehicleId,
                latitude,
                longitude,
              });

            if (insertError) {
              throw new Error(insertError.message);
            }

            setStatus(`Last update: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "GPS update failed");
          }
        },
        (error) => {
          setStatus(error.message || "GPS permission error");
        },
        { enableHighAccuracy: true }
      );
    }, 5000);

    return () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
      }
    };
  }, [vehicleId]);

  return (
    <div style={{ padding: 40 }}>
      <h2>Vehicle {vehicleId} Tracking Active</h2>
      <p>GPS updates run every 5 seconds.</p>
      <p>Keep this page open to continue tracking.</p>
      <p style={{ marginTop: 12 }}>{status}</p>
    </div>
  );
};

export default VehicleTracker;
