import { useState } from 'react';import { useNavigate, useParams } from 'react-router-dom';import { motion } from 'motion/react';import { Loader2 } from 'lucide-react';export function LoginScreen() {
  const navigate = useNavigate();
  const { role } = useParams();
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
  });
  const [loading, setLoading] = useState(false);

  const getRoleName = (roleId: string | undefined) => {
    switch (roleId) {
      case 'logistics-operator':
        return 'Logistics Operator';
      case 'vehicle-driver':
        return 'Vehicle Driver';
      case 'city-planner':
        return 'City Planner';
      default:
        return 'User';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simulate sending OTP
    setTimeout(() => {
      setLoading(false);
      navigate(`/verify-otp/${role}`);
    }, 1000);
  };

  return (
    <div className="min-h-screen urbanflow-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="glass-card-strong rounded-3xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl text-primary-urban mb-2">
              {getRoleName(role)} Login
            </h1>
            <p className="text-muted-urban">
              Enter your details to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-secondary-urban mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="glass-input w-full px-4 py-3 rounded-xl"
                placeholder="Enter your name"
                required
              />
            </div>

            <div>
              <label className="block text-secondary-urban mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="glass-input w-full px-4 py-3 rounded-xl"
                placeholder="+91 XXXXX XXXXX"
                required
              />
            </div>

            <div>
              <label className="block text-secondary-urban mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="glass-input w-full px-4 py-3 rounded-xl"
                placeholder="your.email@example.com"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="glass-button w-full py-4 rounded-xl text-white text-lg flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sending OTP...
                </>
              ) : (
                'Send OTP'
              )}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={() => navigate('/role-selection')}
              className="text-secondary-urban hover:text-primary-urban transition-colors text-sm"
            >
              ← Back to Role Selection
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}