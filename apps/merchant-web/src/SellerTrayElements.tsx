import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

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
