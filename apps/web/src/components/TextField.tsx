import { useId, type InputHTMLAttributes } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
}

/**
 * Label and input are linked by a real `htmlFor`/`id` pair (via `useId`, so
 * two instances on one page never collide) rather than nesting the input
 * inside the label text — this keeps the association verifiable by
 * assistive tech and by `getByLabelText` in tests, not just visually
 * apparent. A validation error is exposed through `aria-invalid` and
 * `aria-describedby`, not color alone.
 */
export function TextField({ label, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={["field__input", className].filter(Boolean).join(" ")}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        {...rest}
      />
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
