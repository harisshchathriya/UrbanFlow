import { useNavigate } from 'react-router-dom';import { motion } from 'motion/react';import { Truck } from 'lucide-react';export function WelcomeScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen urbanflow-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8 flex justify-center"
        >
          <div className="glass-card-strong rounded-full p-8">
            <Truck className="w-24 h-24 text-white" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="text-6xl md:text-7xl mb-4 text-primary-urban tracking-wide"
        >
          URBANFLOW
        </motion.h1>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="text-xl md:text-2xl text-secondary-urban mb-12 max-w-2xl mx-auto"
        >
          Optimizing Urban Freight for Smarter Cities
        </motion.p>

        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          onClick={() => navigate('/role-selection')}
          className="glass-button px-12 py-4 rounded-2xl text-white text-xl hover:glow-cyan"
        >
          Get Started
        </motion.button>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.6 }}
          className="mt-16 text-muted-urban text-sm"
        >
          <p>Powered by Smart City Technology</p>
          <p className="mt-1">Chennai Metropolitan Area</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
