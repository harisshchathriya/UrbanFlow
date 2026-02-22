import { useState } from 'react';import { useNavigate } from 'react-router-dom';import { LogOut } from 'lucide-react';import { supabase } from '../../services/supabaseClient';import { clearVerifiedRole } from '../auth/fallbackAuth';interface DashboardHeaderProps {
  title: string;
  subtitle: string;
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setSignOutError(null);
    clearVerifiedRole();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSignOutError(error.message);
      return;
    }
    navigate('/');
  };

  return (
    <div className="glass-card-strong rounded-2xl p-6 mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl text-primary-urban mb-1">{title}</h1>
        <p className="text-secondary-urban">{subtitle}</p>
      </div>
      <div className="flex flex-col items-end">
        <button
          onClick={handleLogout}
          className="glass-button px-6 py-3 rounded-xl flex items-center gap-2 text-white"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
        {signOutError && (
          <p className="text-xs text-red-300 mt-2">{signOutError}</p>
        )}
      </div>
    </div>
  );
}
