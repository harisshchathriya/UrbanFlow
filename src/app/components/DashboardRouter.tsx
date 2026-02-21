import { Navigate, useParams } from 'react-router-dom';

export function DashboardRouter() {
  const { role } = useParams();

  switch (role) {
    case 'logistics-operator':
      return <Navigate to="/dashboard/logistics-operator" replace />;
    case 'vehicle-driver':
      return <Navigate to="/dashboard/vehicle-driver/vehicle-001" replace />;
    case 'city-planner':
      return <Navigate to="/dashboard/city-planner" replace />;
    default:
      return <Navigate to="/role-selection" replace />;
  }
}
