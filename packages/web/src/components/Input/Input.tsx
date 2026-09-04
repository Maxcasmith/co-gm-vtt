import {
  useEffect,
  useState,
  type ChangeEvent,
  type HTMLAttributes,
} from "react";
import { useFormContext } from "../Form/Form";
import "./Input.css";

interface InputFieldProps<
  T extends string,
> extends HTMLAttributes<HTMLInputElement> {
  value: string;
  disabled: boolean;
  label: string;
  name: T;
  placeholder: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  errors: Map<string, string[]>;
  type: string;
}

export function Input<T extends string>(props: Partial<InputFieldProps<T>>) {
  const formContext = useFormContext();

  const {
    name = "",
    className,
    label = name,
    onChange,
    value = formContext ? formContext.form[name] : "",
    disabled = formContext ? !formContext.formActive : false,
    errors = formContext ? formContext.errors : new Map(),
    placeholder = "Enter Text Here",
    ...rest
  } = props;

  const [dirtyValue, setDirtyValue] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDirtyValue(value);
  }

  const handleOnChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDirtyValue(val);

    if (onChange) onChange(e);
  };

  // formContext is a new object every Form render (see Form.tsx) — including it here
  // would loop: this effect calls setForm, which re-renders Form, which recreates
  // formContext, which reruns this effect. Only dirtyValue should retrigger it.
  useEffect(() => {
    if (formContext) formContext.setForm({ [name]: dirtyValue });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyValue]);

  return (
    <div className="input--wrapper">
      <label htmlFor={name}>
        {label}
        <input
          name={name}
          value={dirtyValue}
          onChange={handleOnChange}
          disabled={disabled}
          className={inputClassName(className, errors.get(name))}
          placeholder={placeholder}
          {...rest}
        />
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

function inputClassName(className: string = "", errors: string[]) {
  if (errors) return `${className} errors`;
  return className;
}
