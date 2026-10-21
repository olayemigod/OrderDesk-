import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import './sellertray-elements.css';

function classes(base: string, className?: string) {
  return className ? `${base} ${className}` : base;
}

export const SellerTrayInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={classes('sellertray-input', className)} {...props} />
  ),
);
SellerTrayInput.displayName = 'SellerTrayInput';

export const SellerTraySelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={classes('sellertray-select', className)} {...props} />
  ),
);
SellerTraySelect.displayName = 'SellerTraySelect';

export const SellerTrayTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={classes('sellertray-textarea', className)} {...props} />
  ),
);
SellerTrayTextarea.displayName = 'SellerTrayTextarea';

type SellerTrayTabOption<T extends string> = {
  id: T;
  label: string;
};

export function SellerTrayTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: readonly SellerTrayTabOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return <div className={classes('sellertray-tabs', className)} role="tablist" aria-label={ariaLabel}>
    {options.map((option) => <button
      key={option.id}
      type="button"
      role="tab"
      aria-selected={value === option.id}
      className={value === option.id ? 'active' : undefined}
      onClick={() => onChange(option.id)}
    >{option.label}</button>)}
  </div>;
}
