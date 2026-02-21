import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Truck, User, Building2 } from 'lucide-react';

export function RoleSelectionScreen() {
  const navigate = useNavigate();

  const roles = [
    {
      id: 'logistics-operator',
      icon: Truck,
      title: 'Logistics Operator',
      subtitle: 'Manage fleet & consolidate loads',
    },
    {
      id: 'vehicle-driver',
      icon: User,
      title: 'Vehicle Driver',
      subtitle: 'Track jobs & complete deliveries',
    },
    {
      id: 'city-planner',
      icon: Building2,
      title: 'City Planner',
      subtitle: 'Monitor policy & sustainability',
    },
  ];

  return (
    <div className="min-h-screen urbanflow-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-4xl"
      >
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl text-primary-urban mb-4">
            Select Your Role
          </h1>
          <p className="text-secondary-urban text-lg">
            Choose your dashboard to access role-specific features
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {roles.map((roleItem, index) => (
            <motion.button
              key={roleItem.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 + 0.2, duration: 0.6 }}
              onClick={() => navigate(`/login/${roleItem.id}`)}
              className="glass-card rounded-3xl p-8 hover-lift text-center"
            >
              <div className="glass-card-strong rounded-full p-6 inline-block mb-6">
                <roleItem.icon className="w-16 h-16 text-white" />
              </div>
              <h2 className="text-2xl text-primary-urban mb-2">{roleItem.title}</h2>
              <p className="text-muted-urban">{roleItem.subtitle}</p>
            </motion.button>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="text-center mt-8"
        >
          <button
            onClick={() => navigate('/')}
            className="text-secondary-urban hover:text-primary-urban transition-colors"
          >
            {'<-'} Back to Home
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
