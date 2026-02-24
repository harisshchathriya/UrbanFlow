import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { WelcomeScreen } from './components/WelcomeScreen';
import { RoleSelectionScreen } from './components/RoleSelectionScreen';
import { LoginScreen } from './components/LoginScreen';
import { OTPVerificationScreen } from './components/OTPVerificationScreen';
import { DashboardRouter } from './components/DashboardRouter';
import { LogisticsOperatorDashboard } from './components/LogisticsOperatorDashboard';
import { CityPlannerDashboard } from './components/CityPlannerDashboard';
import { VehicleDriverDashboard } from './components/VehicleDriverDashboard';
import VehicleTracker from './components/VehicleTracker';
import OperatorDeliveriesPage from './OperatorDeliveriesPage';

export const router = createBrowserRouter([
  { path: '/', element: React.createElement(WelcomeScreen) },
  { path: '/role-selection', element: React.createElement(RoleSelectionScreen) },
  { path: '/login/:role', element: React.createElement(LoginScreen) },
  { path: '/verify-otp/:role', element: React.createElement(OTPVerificationScreen) },
  { path: '/otp-verification/:role', element: React.createElement(OTPVerificationScreen) },
  { path: '/dashboard/:role', element: React.createElement(DashboardRouter) },
  { path: '/dashboard/vehicle-driver', element: React.createElement(DashboardRouter) },
  { path: '/dashboard/logistics-operator', element: React.createElement(LogisticsOperatorDashboard) },
  { path: '/operator/deliveries', element: React.createElement(OperatorDeliveriesPage) },
  { path: '/dashboard/vehicle-driver/:vehicleId', element: React.createElement(VehicleDriverDashboard) },
  { path: '/dashboard/city-planner', element: React.createElement(CityPlannerDashboard) },
  { path: '/vehicle-tracker/:vehicleId', element: React.createElement(VehicleTracker) },
]);
