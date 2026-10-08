import { forwardRef, type TextareaHTMLAttributes } from "react";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  const classes = ["ds-textarea", className].filter(Boolean).join(" ");
  return <textarea {...props} ref={ref} className={classes} />;
});
