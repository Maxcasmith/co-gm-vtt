import {
  useEffect,
  useState,
  type ChangeEvent,
  type HTMLAttributes,
} from "react";
import { useFormContext } from "../Form/Form";
import "./Checkbox.css";

interface CheckboxFieldProps<
  T extends string,
> extends HTMLAttributes<HTMLInputElement> {
  checked: boolean;
  label: string;
  name: T;
  onCheckToggle: (e: ChangeEvent<HTMLInputElement>) => void;
  errors: Map<string, string[]>;
}

export function Checkbox<T extends string>(
  props: Partial<CheckboxFieldProps<T>>,
) {
  const formContext = useFormContext();

  const {
    name = "",
    label = name,
    onCheckToggle,
    className,
    errors = formContext ? formContext.errors : new Map(),
    checked = formContext?.form[name] ?? false,
    ...rest
  } = props;

  const [dirtyChecked, setDirtyChecked] = useState(checked);

  const handleOnChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDirtyChecked(!dirtyChecked);

    if (onCheckToggle) onCheckToggle(e);
  };

  // formContext is a new object every Form render (see Form.tsx) — including it here
  // would loop: this effect calls setForm, which re-renders Form, which recreates
  // formContext, which reruns this effect. Only dirtyChecked should retrigger it.
  useEffect(() => {
    if (formContext) formContext.setForm({ [name]: dirtyChecked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyChecked]);

  return (
    <div className="checkbox--wrapper">
      <label htmlFor={name}>
        <input
          id={name}
          type="checkbox"
          name={name}
          onChange={handleOnChange}
          className={checkboxClassName(className, errors.get(name))}
          checked={dirtyChecked}
          {...rest}
        />
        <span className="checkbox--custom--checkbox">
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path
              d="M1.5 6L6 10.5L14.5 1.5"
              stroke="#1a1000"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="checkbox--custom--label">{label}</span>
      </label>
      {errors.get(name) && (
        <div className="input--errors--container">
          <span>Please address the following errors</span>
          <ul>
            {errors.get(name).map((e: string, i: number) => (
              <li key={`err_${i}`}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function checkboxClassName(className: string = "", errors: string[]) {
  if (errors) return `${className} errors`;
  return className;
}
