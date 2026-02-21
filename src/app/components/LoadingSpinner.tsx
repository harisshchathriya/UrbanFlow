interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function LoadingSpinner({ size = 'medium', className = '' }: LoadingSpinnerProps) {
  const sizeClass = size === 'small' ? 'spinner-small' : size === 'large' ? 'w-16 h-16' : 'spinner';
  
  return (
    <div className={`${sizeClass} ${className}`} />
  );
}
