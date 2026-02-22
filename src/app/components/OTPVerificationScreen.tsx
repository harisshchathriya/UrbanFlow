import { useState, useRef, useEffect } from 'react';import { useNavigate, useParams } from 'react-router-dom';import { motion } from 'motion/react';import { Loader2 } from 'lucide-react';import { setVerifiedRole } from '../auth/fallbackAuth';import { supabase } from '../../services/supabaseClient';export function OTPVerificationScreen() {
  const navigate = useNavigate();
  const { role } = useParams();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(true);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Auto-focus first input on mount
    inputRefs.current[0]?.focus();
    setLoading(false);
  }, []);

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    const digits = pastedData.split('').filter(char => /^\d$/.test(char));
    
    const newOtp = [...otp];
    digits.forEach((digit, index) => {
      if (index < 6) {
        newOtp[index] = digit;
      }
    });
    setOtp(newOtp);

    // Focus the next empty input or last input
    const nextIndex = Math.min(digits.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpValue = otp.join('');
    if (otpValue.length !== 6) return;

    setLoading(true);

    if (role) {
      setVerifiedRole(role);
    }

    if (role === 'vehicle-driver') {
      const { data, error } = await supabase.from('drivers').select('id').limit(1);
      if (!error && data && data[0]?.id) {
        setLoading(false);
        navigate(`/dashboard/vehicle-driver/${data[0].id}`);
        return;
      }
    }

    setLoading(false);
    if (role) {
      navigate(`/dashboard/${role}`);
    } else {
      navigate('/role-selection');
    }
  };

  const handleResendOTP = () => {
    // Clear OTP inputs
    setOtp(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();
    
    // Show feedback (in real app, would trigger OTP resend)
    alert('New OTP sent to your registered contact');
  };

  const handleEditDetails = () => {
    navigate(`/login/${role}`);
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
            <h1 className="text-3xl text-primary-urban mb-3">
              Verify OTP
            </h1>
            <p className="text-secondary-urban text-sm">
              A 6-digit verification code has been sent to your registered contact
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* OTP Input Boxes */}
            <div>
              <div className="flex justify-center gap-3 mb-3">
                {otp.map((digit, index) => (
  <input
    key={index}
    ref={(el) => {
      inputRefs.current[index] = el;
    }}
    type="text"
    inputMode="numeric"
    maxLength={1}
    value={digit}
    onChange={(e) => handleChange(index, e.target.value)}
    onKeyDown={(e) => handleKeyDown(index, e)}
    onPaste={handlePaste}
    className="glass-input w-14 h-14 text-center text-2xl rounded-xl font-medium"
  />
))}
              </div>
              <p className="text-center text-muted-urban text-sm">
                Enter the 6-digit code to continue
              </p>
            </div>

            {/* Primary CTA */}
            <button
              type="submit"
              disabled={loading}
              className="glass-button w-full py-4 rounded-xl text-white text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify & Continue'
              )}
            </button>
          </form>

          {/* Secondary Actions */}
          <div className="mt-6 space-y-3">
            <div className="text-center">
              <button
                onClick={handleResendOTP}
                className="text-cyan-glow hover:text-primary-urban transition-colors text-sm"
              >
                Resend OTP
              </button>
            </div>
            <div className="text-center">
              <button
                onClick={handleEditDetails}
                className="text-secondary-urban hover:text-primary-urban transition-colors text-sm"
              >
                â Edit Details
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
