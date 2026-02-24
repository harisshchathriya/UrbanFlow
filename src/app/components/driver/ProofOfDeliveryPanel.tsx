import { useMemo, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../services/supabaseClient';

type ProofOfDeliveryPanelProps = {
  deliveryId: string | null;
  expectedOtp: string | null;
  onSuccess: (payload: { imageUrl: string; notes: string }) => Promise<void>;
};

const POD_BUCKET = 'pod-images';

export function ProofOfDeliveryPanel({ deliveryId, expectedOtp, onSuccess }: ProofOfDeliveryPanelProps) {
  const [otp, setOtp] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!deliveryId || !file || otp.trim().length < 4) return false;
    if (!expectedOtp) return true;
    return otp.trim() === expectedOtp.trim();
  }, [deliveryId, file, otp, expectedOtp]);

  const onFileChange = (nextFile: File | null) => {
    setFile(nextFile);
    setSuccess(null);
    if (!nextFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(nextFile);
    setPreviewUrl(objectUrl);
  };

  const uploadPodImage = async (): Promise<string> => {
    if (!file || !deliveryId) {
      throw new Error('Missing image or delivery id.');
    }
    const fileExt = file.name.split('.').pop() || 'jpg';
    const filePath = `${deliveryId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage.from(POD_BUCKET).upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from(POD_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const imageUrl = await uploadPodImage();
      await onSuccess({ imageUrl, notes: notes.trim() });
      setSuccess('Proof of delivery submitted.');
      setOtp('');
      setNotes('');
      setFile(null);
      setPreviewUrl(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit proof of delivery.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl shadow-xl bg-white/10 backdrop-blur-md border border-white/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl text-primary-urban">Proof of Delivery</h3>
        {deliveryId && (
          <span className="text-xs rounded-full bg-cyan-500/20 px-3 py-1 text-cyan-100">
            Delivery #{deliveryId.slice(0, 8)}
          </span>
        )}
      </div>

      {!deliveryId && <p className="text-secondary-urban">Start a delivery and arrive at destination to submit POD.</p>}

      {deliveryId && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm text-secondary-urban">OTP</span>
            <input
              type="text"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              className="mt-1 w-full rounded-xl glass-input px-4 py-2"
              placeholder="Enter OTP"
            />
          </label>

          <label className="block">
            <span className="text-sm text-secondary-urban flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Delivery Photo
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => onFileChange(event.target.files?.[0] || null)}
              className="mt-1 w-full rounded-xl glass-input px-4 py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500/30 file:px-3 file:py-1 file:text-white"
            />
          </label>

          {previewUrl && (
            <img src={previewUrl} alt="POD preview" className="w-full max-h-64 object-cover rounded-xl border border-white/20" />
          )}

          <label className="block">
            <span className="text-sm text-secondary-urban">Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl glass-input px-4 py-2"
              placeholder="Leave a short delivery note"
            />
          </label>

          {expectedOtp && otp && otp !== expectedOtp && (
            <p className="text-sm text-yellow-200">OTP does not match the delivery code.</p>
          )}

          {error && <p className="text-sm text-red-200">{error}</p>}
          {success && (
            <p className="text-sm text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="w-full rounded-xl bg-emerald-500/30 hover:bg-emerald-500/50 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-white font-medium transition"
          >
            {isSubmitting ? 'Submitting POD...' : 'Submit Proof of Delivery'}
          </button>
        </div>
      )}
    </div>
  );
}
